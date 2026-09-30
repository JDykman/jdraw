# jdraw — Fable 5.1 handoff spec

Four tickets from the jdraw roadmap, chosen for Fable because a subtle mistake loses user data or the work spans the whole stack. Do them in order: **JD-2 → JD-3 → JD-22 → JD-21**. JD-22 depends on JD-3; JD-21 is independent but the largest.

## Context

jdraw is a self-hosted tldraw 4.4.1 canvas with an AI agent, used by the owner and a few friends (single instance, a handful of users — no need to design for scale).

- **Client:** React 19 + Vite, `client/`. Canvas in `client/App.tsx`, page list in `client/pages/PageListSidebar.tsx`, auth via `useAuth()` (`getToken()` for `Authorization: Bearer`).
- **Server:** Express 5 + `ws`, `server/`. SQLite via better-sqlite3 (synchronous), schema in `server/db/schema.sql` (applied with `CREATE TABLE IF NOT EXISTS` on every boot — there is no migration system, so new tables go in that file and column changes need an explicit, idempotent `ALTER` guarded in `server/db/db.ts`).
- **Sync:** `@tldraw/sync-core` `TLSocketRoom`, one room per page, in `server/sync/roomManager.ts`; auth + per-page access in `server/sync/wsHandler.ts` (`canAccess()` from `server/routes/pages.ts` returns `{ allowed, canEdit }`).
- **Persistence today:** one row per page in `page_snapshots` holding `JSON.stringify(room.getCurrentSnapshot())`, rewritten 1s after each change and on last disconnect/eviction/SIGTERM.
- **Custom shape:** `table` (`shared/table/tableShapeProps.ts`). Any schema you build server-side must include it (see `roomManager.ts`).
- **Deploy:** `Containerfile`, DB at `/data/jdraw.db`, pushed to GHCR on `master`.

### Conventions

- Tabs, no semicolons, single quotes. Server imports use `.js` extensions (ESM). Match surrounding comment density.
- Every API route checks access with `canAccess()` / owner checks the way `server/routes/pages.ts` does.
- No test runner exists. Verify with `npx tsc --noEmit -p tsconfig.json` and `npx tsc --noEmit -p tsconfig.server.json`, plus `npm run build`. For server logic, add focused tests with `node:test` run through `tsx` (no new dependencies) under `server/**/__tests__/`, and add an `npm test` script.
- `scripts/test_snapshots.mjs` builds a schema without the `table` shape — fix that if you touch it.

### Decisions already made (don't reopen)

- Auto checkpoints every **5 minutes** while a page has changes; auto checkpoints kept **30 days**.
- Notifications are **in-app only** (no email).
- GitHub embed cards are **out of scope**.

---

## JD-2 — Snapshot load safety

### Problem

`server/sync/roomManager.ts` can silently destroy a page:

1. `loadSnapshot()` returns `undefined` on `JSON.parse` failure — identical to "empty page".
2. `getOrCreateRoom()` catches a `TLSocketRoom` constructor error (e.g. schema/migration failure) and falls back to `createRoom(pageId, undefined)`.
3. In both cases the empty room is then persisted over the good row on the next change, on last disconnect, or on eviction.

Also: `writeRoomSnapshot()` uses `UPDATE … WHERE page_id = ?`, which silently writes nothing if the `page_snapshots` row is missing.

### Requirements

1. Distinguish three load outcomes: **empty** (no row or `'{}'`), **loaded**, **failed** (parse error or room construction error).
2. On **failed**:
   - Preserve the raw stored text by inserting it into `page_checkpoints` with `kind = 'quarantine'` (create the table as specified in JD-3 as part of this ticket).
   - Do **not** create a writable room. Reject the WebSocket connection with a close code/reason the client can recognise (e.g. close code `4001`, reason `snapshot-load-failed`), and log the page id and error.
   - Never write to `page_snapshots` for that page until a restore (JD-3) replaces it.
3. Rooms track whether they were created from a successful load. `writeRoomSnapshot()` refuses to write for a room that wasn't (defence in depth).
4. Replace the `UPDATE` with an upsert (`INSERT … ON CONFLICT(page_id) DO UPDATE`).
5. Shutdown: handle `SIGINT` the same as `SIGTERM` in `server/index.ts`, and make sure pending change timers are flushed before `db.close()`.
6. Client: when the socket closes with the load-failure code, `client/App.tsx` shows a clear message ("This page couldn't be loaded. Your data was preserved.") with a Back button, instead of retrying forever. After JD-3 lands, add an "Open history" action there.

### Acceptance

- Corrupting a page's `page_snapshots.snapshot` by hand (invalid JSON, or valid JSON with an unknown shape type) and opening the page: the raw text is in `page_checkpoints` as `quarantine`, the original row is unchanged, the client shows the error state, and reconnect attempts don't change the row.
- A normal page still loads, edits persist, and eviction still persists.
- Tests cover: empty / loaded / failed outcomes; no write after failed load; upsert when the row is missing.

---

## JD-3 — Page version history + restore

### Data model (`server/db/schema.sql`)

```sql
CREATE TABLE IF NOT EXISTS page_checkpoints (
    id          TEXT PRIMARY KEY,
    page_id     TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL,          -- 'auto' | 'manual' | 'pre-restore' | 'quarantine'
    label       TEXT,
    snapshot    TEXT NOT NULL,          -- RoomSnapshot JSON (or raw text for quarantine)
    doc_clock   INTEGER,                -- room.getCurrentDocumentClock() at capture
    created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_checkpoints_page ON page_checkpoints(page_id, created_at DESC);
```

### Capture rules

- **Auto:** while a room is active, every 5 minutes, take a checkpoint only if `getCurrentDocumentClock()` advanced since the room's last checkpoint. Also take one on eviction if it changed since the last checkpoint. Use one interval per room, cleared on eviction.
- **Manual:** user-triggered with an optional label.
- **Pre-restore:** always taken immediately before a restore.
- **Retention:** a daily sweep (plus one on boot) deletes `auto` and `pre-restore` checkpoints older than 30 days. `manual` and `quarantine` are kept until deleted by the page owner.
- Never checkpoint a room that failed to load (JD-2).

### API (`server/routes/checkpoints.ts`, mounted under `/api/pages`)

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/:id/checkpoints` | any access | Metadata only (no `snapshot`), newest first, with `created_by` username |
| GET | `/:id/checkpoints/:cid` | any access | Includes `snapshot` (for JD-22 compare) |
| POST | `/:id/checkpoints` | canEdit | Manual checkpoint `{ label? }`; if the room is active, snapshot it live, else copy `page_snapshots` |
| POST | `/:id/checkpoints/:cid/restore` | canEdit | See below |
| DELETE | `/:id/checkpoints/:cid` | owner | Only `manual` / `quarantine` |

### Restore — the risky part

- Take a `pre-restore` checkpoint of the current state (skip if the page is in the JD-2 failed state; that state is already quarantined).
- **Room active:** use `room.loadSnapshot(snapshot)` so connected clients (friends included) receive the restored document. Verify in tldraw 4.4.1 source how connected sessions react (full resync vs. forced reconnect) and make sure no client can push stale state back over the restore. If that can't be guaranteed, close all sessions after loading so they reconnect cleanly. Then persist immediately.
- **Room not active:** write `page_snapshots` directly.
- **Page in JD-2 failed state:** restore writes `page_snapshots` and clears the failed state so the next connection loads normally.
- Old checkpoints may predate schema changes (new tldraw versions, table shape props). Confirm `TLSocketRoom` migrates on `loadSnapshot` / construction. If it throws, return 422 with the error and change nothing.
- Quarantine checkpoints can't be restored directly (they may not be valid JSON); return 400.

### UI

- A "History" button next to the existing Pages button in the canvas overlay (`BackToPagesButton` area in `client/App.tsx`) opens a side panel: checkpoints grouped by day, showing time, kind, label and author, plus "Save version" with a label input.
- Each row has a **Restore** button (with confirmation dialog; disabled for read-only users) and a **Compare** button (JD-22).
- Also reachable from the JD-2 error screen.

### Acceptance

- Editing for more than 5 minutes creates auto checkpoints; an idle page creates none.
- With two browsers on the same page, restoring in one updates the other without stale edits reappearing afterwards.
- Restore always leaves a `pre-restore` checkpoint, so a restore can be undone.
- The retention sweep deletes only expired `auto`/`pre-restore` rows.
- Tests cover capture throttling, retention, and restore when the room is inactive, active, or in the failed state.

---

## JD-22 — Snapshot compare

Compare the current page against any checkpoint, using the existing diff viewer.

- Reuse `client/components/chat-history/TldrawDiffViewer.tsx` (it takes a `RecordsDiff<TLRecord>` and renders added/removed/updated shapes with `meta.changeType` styling). Keep its API intact for the chat history.
- Fetch the checkpoint via `GET /:id/checkpoints/:cid`. Convert the `RoomSnapshot` (`documents[].state` + `schema`) into a store snapshot and **migrate it** with `editor.store.schema.migrateStoreSnapshot(...)` before diffing. Show an error if migration fails.
- Build a `RecordsDiff` of **shape records on the current tldraw page** only: checkpoint → current (added = in current only, removed = in checkpoint only, updated = in both but not deep-equal). Ignore shapes on other tldraw pages, as well as bindings and assets.
- UI: a "Compare" button on each history row opens a modal/panel with the diff viewer plus counts ("+4 added, 2 changed, 1 removed") and a toggle for "checkpoint → now" vs. "now → checkpoint".
- Performance: pages can hold hundreds of shapes. The viewer already drops shadows above 20 shapes; make sure the diff itself is O(n).

**Out of scope:** partial restore of individual shapes.

### Acceptance

- Comparing against a checkpoint taken before a known edit shows exactly that edit.
- A checkpoint from before a table-shape prop change still compares after migration.
- The chat-history diff view is unchanged.

---

## JD-21 — Comments + @mentions

Threaded comments pinned to shapes or canvas points, with @mentions and in-app unread notifications.

### Data model

```sql
CREATE TABLE IF NOT EXISTS comment_threads (
    id          TEXT PRIMARY KEY,
    page_id     TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    shape_id    TEXT,                   -- tldraw shape id, null = pinned to a canvas point
    anchor_x    REAL NOT NULL,          -- relative to the shape's page bounds (0..1) when shape_id is set, page coords otherwise
    anchor_y    REAL NOT NULL,
    last_x      REAL,                   -- last known page position, used if the shape is deleted
    last_y      REAL,
    resolved_at INTEGER,
    resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS comments (
    id          TEXT PRIMARY KEY,
    thread_id   TEXT NOT NULL REFERENCES comment_threads(id) ON DELETE CASCADE,
    author_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
    body        TEXT NOT NULL,          -- plain text; mentions stored as @username
    created_at  INTEGER NOT NULL,
    edited_at   INTEGER
);
CREATE TABLE IF NOT EXISTS comment_mentions (
    comment_id  TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (comment_id, user_id)
);
CREATE TABLE IF NOT EXISTS comment_reads (
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    page_id      TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    last_read_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, page_id)
);
```

Adjust the schema if you find a better shape, but keep threads, mentions and read state.

### Permissions

- Anyone with page access, **including read-only shares**, can create threads and reply.
- Authors can edit or delete their own comments. The page owner can delete any comment or thread. Anyone with access can resolve or reopen.
- Mentions resolve only to users who have access to the page. Mentioning someone without access doesn't grant it; the autocomplete marks them as "no access".

### API (`server/routes/comments.ts`)

- CRUD for threads and comments scoped to a page; `POST /:id/comments/read` updates `comment_reads`.
- `GET /api/notifications`: per page, the unread comment count and unread mentions for the current user (comments after `last_read_at` not written by the user). Mentions of the user count even on pages they rarely open.
- **Realtime:** after any comment mutation, notify connected clients of that page. Use `room.sendCustomMessage` to each session in the active room (expose a helper from `roomManager.ts`); clients refetch that page's threads. Don't store comments in the tldraw document.

### Client

- **Markers:** rendered in `InFrontOfTheCanvas` (see `components` in `client/App.tsx`). Position = shape page bounds + relative anchor, transformed to screen coordinates, reactive to camera and shape moves via `useValue`. Clicking opens the thread popover.
- **Creating:** a "Comment" tool/shortcut (check tldraw's default keybindings for conflicts) — click a shape to pin to it, or empty canvas to pin to a point. Also add "Add comment" to the right-click menu (`client/shapes/table/TableContextMenu.tsx` is the current context menu component; generalise it).
- **Deleted shapes:** the thread keeps rendering at `last_x`/`last_y` with a "shape deleted" hint. The client updates `last_x/last_y` when it notices the shape moved (throttled), so the fallback position is recent.
- **Thread popover:** replies, @mention autocomplete (users with access), resolve/reopen, edit/delete per the permissions above.
- **Comments panel:** lists all threads on the page, filterable by open/resolved/mentions-me; clicking one zooms to it.
- **Unread:** opening the page (or the panel) marks it read. The page list (`client/pages/PageListSidebar.tsx`) shows an unread count per page and an @ badge for mentions. The homepage is being redesigned in a separate ticket (JD-6), so keep the badge a small self-contained component.
- Hide markers during export/screenshot so they don't leak into images or AI screenshots (`client/parts/ScreenshotPartUtil.ts` uses `editor.toImage`, which only renders shapes, so this is likely already fine — verify).

### Acceptance

- Two users on the same page see each other's new comments within about a second, without reloading.
- A thread pinned to a shape follows it when moved or resized, and falls back cleanly when the shape is deleted.
- A read-only share can comment but can't edit the canvas.
- @mentioning a user shows an @ badge on their page list until they open the page.
- Deleting a page deletes its comments (cascade).
- Tests cover permission checks, mention resolution (including no-access users), and unread counting.

---

## Delivery

- One commit per ticket (or a few per ticket for JD-21), with clear messages.
- Include in the final summary: any tldraw sync behaviour you had to verify (especially `loadSnapshot` with connected clients), deviations from this spec and why, and any manual steps needed on the production box (none are expected — schema changes are additive).
