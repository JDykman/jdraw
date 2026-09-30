CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin      INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pages (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS page_shares (
    page_id  TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    can_edit INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (page_id, user_id)
);

CREATE TABLE IF NOT EXISTS page_snapshots (
    page_id    TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
    snapshot   TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_state (
    page_id    TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    state_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (page_id, user_id)
);

CREATE TABLE IF NOT EXISTS user_api_keys (
    user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    openai_key    TEXT,
    anthropic_key TEXT,
    google_key    TEXT,
    updated_at    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_pages_owner  ON pages(owner_id);
CREATE INDEX IF NOT EXISTS idx_shares_user  ON page_shares(user_id);

-- Page metadata for the homepage: tags (shared per page), pins and last-viewed (per user), thumbnails.
CREATE TABLE IF NOT EXISTS page_tags (
    page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    tag     TEXT NOT NULL,
    PRIMARY KEY (page_id, tag)
);

CREATE TABLE IF NOT EXISTS page_pins (
    user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    page_id   TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    pinned_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, page_id)
);

CREATE TABLE IF NOT EXISTS page_views (
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    page_id        TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    last_viewed_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, page_id)
);

CREATE TABLE IF NOT EXISTS page_thumbnails (
    page_id    TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
    png        BLOB NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_page_tags_tag ON page_tags(tag);

-- Page version history. Also holds quarantined raw text when a stored snapshot fails to load.
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

-- Comment threads pinned to a shape (relative anchor) or a canvas point, with @mentions and
-- per-user read state for unread badges.
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
CREATE INDEX IF NOT EXISTS idx_comment_threads_page ON comment_threads(page_id);
CREATE INDEX IF NOT EXISTS idx_comments_thread ON comments(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comment_mentions_user ON comment_mentions(user_id);
