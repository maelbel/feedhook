/**
 * Database schema, as an ordered list of migrations. Each one runs once, in
 * a transaction, and its number is recorded in `schema_migrations`.
 *
 * Rule: never edit a migration that has been released. To change the
 * schema, append a new one.
 */
export const MIGRATIONS: readonly string[] = [
  // 1. Initial schema
  `
  CREATE TABLE seen_items (
    feed_id  TEXT NOT NULL,
    item_id  TEXT NOT NULL,
    seen_at  TEXT NOT NULL,
    PRIMARY KEY (feed_id, item_id)
  ) WITHOUT ROWID;

  CREATE TABLE feed_state (
    feed_id        TEXT PRIMARY KEY,
    etag           TEXT,
    last_modified  TEXT,
    seeded_at      TEXT,
    updated_at     TEXT NOT NULL
  );
  `,
];
