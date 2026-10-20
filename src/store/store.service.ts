import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { AppConfig } from '../config/index.js';
import type { CacheValidators } from '../fetcher/index.js';
import { MIGRATIONS } from './migrations.js';

export const DB_FILE_NAME = 'feedhook.db';

/**
 * Remembers what feedhook has already done, in a SQLite file in `DATA_DIR`:
 * - which items were posted (`seen_items`), so each one is posted once;
 * - per feed, the HTTP cache validators and whether the first, silent run
 *   (the "seed") is done (`feed_state`).
 *
 * Uses Node's built-in `node:sqlite` (no native module to compile on the Pi).
 * Every query uses `?` placeholders: feed content never becomes SQL.
 */
@Injectable()
export class StoreService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StoreService.name);
  private db?: DatabaseSync;

  constructor(private readonly config: AppConfig) {}

  onModuleInit(): void {
    this.open();
  }

  onModuleDestroy(): void {
    this.close();
  }

  open(): void {
    if (this.db) return;
    // Only the app's user needs to read the database.
    mkdirSync(this.config.dataDir, { recursive: true, mode: 0o700 });
    const path = join(this.config.dataDir, DB_FILE_NAME);

    const db = new DatabaseSync(path);
    // WAL: readers never wait for the writer, and a crash cannot corrupt
    // committed data. busy_timeout: wait instead of failing if locked.
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;
    `);
    this.db = db;

    const applied = this.migrate();
    this.logger.log(
      `database ready: ${path}${applied ? ` (${applied} migration(s) applied)` : ''}`,
    );
  }

  close(): void {
    this.db?.close();
    this.db = undefined;
  }

  /** The ids among `itemIds` not posted yet for this feed, in the same order. */
  unseenIds(feedId: string, itemIds: readonly string[]): string[] {
    const stmt = this.connection.prepare(
      'SELECT 1 FROM seen_items WHERE feed_id = ? AND item_id = ?',
    );
    return itemIds.filter((itemId) => stmt.get(feedId, itemId) === undefined);
  }

  isSeen(feedId: string, itemId: string): boolean {
    return this.unseenIds(feedId, [itemId]).length === 0;
  }

  /**
   * Records items as posted. Call it only after Discord accepted the post.
   * Marking an item twice is harmless.
   */
  markSeen(feedId: string, itemIds: readonly string[]): void {
    const stmt = this.connection.prepare(
      'INSERT OR IGNORE INTO seen_items (feed_id, item_id, seen_at) VALUES (?, ?, ?)',
    );
    const now = new Date().toISOString();
    this.transaction(() => {
      for (const itemId of itemIds) stmt.run(feedId, itemId, now);
    });
  }

  hasBeenSeeded(feedId: string): boolean {
    const row = this.connection
      .prepare('SELECT seeded_at FROM feed_state WHERE feed_id = ?')
      .get(feedId);
    return typeof row?.seeded_at === 'string';
  }

  /**
   * First run of a feed: marks every current item as seen without posting
   * anything, and remembers that the seed is done. All or nothing.
   */
  seed(feedId: string, itemIds: readonly string[]): void {
    const now = new Date().toISOString();
    this.transaction(() => {
      this.markSeen(feedId, itemIds);
      this.connection
        .prepare(
          `INSERT INTO feed_state (feed_id, seeded_at, updated_at) VALUES (?, ?, ?)
           ON CONFLICT (feed_id) DO UPDATE SET seeded_at = excluded.seeded_at,
                                               updated_at = excluded.updated_at`,
        )
        .run(feedId, now, now);
    });
  }

  getValidators(feedId: string): CacheValidators {
    const row = this.connection
      .prepare('SELECT etag, last_modified FROM feed_state WHERE feed_id = ?')
      .get(feedId);
    return {
      ...(typeof row?.etag === 'string' && { etag: row.etag }),
      ...(typeof row?.last_modified === 'string' && {
        lastModified: row.last_modified,
      }),
    };
  }

  saveValidators(feedId: string, validators: CacheValidators): void {
    this.connection
      .prepare(
        `INSERT INTO feed_state (feed_id, etag, last_modified, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (feed_id) DO UPDATE SET etag = excluded.etag,
                                             last_modified = excluded.last_modified,
                                             updated_at = excluded.updated_at`,
      )
      .run(
        feedId,
        validators.etag ?? null,
        validators.lastModified ?? null,
        new Date().toISOString(),
      );
  }

  private get connection(): DatabaseSync {
    if (!this.db) throw new Error('StoreService: database is not open');
    return this.db;
  }

  /** Runs `work` in a transaction; nested calls join the outer one. */
  private transaction(work: () => void): void {
    const db = this.connection;
    if (db.isTransaction) {
      work();
      return;
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      work();
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  /** Applies the migrations not applied yet; returns how many ran. */
  private migrate(): number {
    const db = this.connection;
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     INTEGER PRIMARY KEY,
        applied_at  TEXT NOT NULL
      )
    `);
    const row = db
      .prepare(
        'SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations',
      )
      .get();
    const current = Number(row?.version ?? 0);

    if (current > MIGRATIONS.length) {
      throw new Error(
        `database schema v${current} is newer than this feedhook (v${MIGRATIONS.length}): ` +
          'refusing to start with an older version',
      );
    }

    MIGRATIONS.slice(current).forEach((sql, index) => {
      const version = current + index + 1;
      this.transaction(() => {
        db.exec(sql);
        db.prepare(
          'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
        ).run(version, new Date().toISOString());
      });
    });
    return MIGRATIONS.length - current;
  }
}
