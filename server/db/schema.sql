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
