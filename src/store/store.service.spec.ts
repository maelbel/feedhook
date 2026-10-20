import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppConfig } from '../config/index.js';
import { MIGRATIONS } from './migrations.js';
import { StoreModule } from './store.module.js';
import { DB_FILE_NAME, StoreService } from './store.service.js';

describe('StoreService', () => {
  let dataDir: string;
  let store: StoreService;

  const configFor = (dir: string): AppConfig =>
    new AppConfig([], '0 * * * *', dir, undefined);
  const openStore = (dir = dataDir): StoreService => {
    const instance = new StoreService(configFor(dir));
    instance.open();
    return instance;
  };

  beforeAll(() => {
    Logger.overrideLogger(false);
  });

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'feedhook-store-'));
    store = openStore();
  });

  afterEach(() => {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  describe('seen items', () => {
    it('reports which ids are new, keeping their order', () => {
      store.markSeen('nuxt-blog', ['a', 'c']);

      expect(store.unseenIds('nuxt-blog', ['d', 'a', 'b', 'c'])).toEqual([
        'd',
        'b',
      ]);
      expect(store.isSeen('nuxt-blog', 'a')).toBe(true);
      expect(store.isSeen('nuxt-blog', 'b')).toBe(false);
    });

    it('keeps feeds separate', () => {
      store.markSeen('nuxt-blog', ['same-id']);

      expect(store.isSeen('nestjs-releases', 'same-id')).toBe(false);
    });

    it('marking an item twice is harmless', () => {
      store.markSeen('f', ['a']);

      expect(() => store.markSeen('f', ['a', 'a'])).not.toThrow();
      expect(store.unseenIds('f', ['a'])).toEqual([]);
    });

    it('treats ids as data, never as SQL', () => {
      const nasty = "x'); DROP TABLE seen_items; --";
      store.markSeen('f', [nasty]);

      expect(store.isSeen('f', nasty)).toBe(true);
      expect(store.isSeen('f', 'other')).toBe(false);
    });
  });

  describe('seed', () => {
    it('marks every item as seen and remembers the seed', () => {
      expect(store.hasBeenSeeded('nuxt-blog')).toBe(false);

      store.seed('nuxt-blog', ['a', 'b']);

      expect(store.hasBeenSeeded('nuxt-blog')).toBe(true);
      expect(store.unseenIds('nuxt-blog', ['a', 'b', 'c'])).toEqual(['c']);
      expect(store.hasBeenSeeded('nestjs-releases')).toBe(false);
    });

    it('counts as done even for a feed with no items yet', () => {
      store.seed('empty-feed', []);

      expect(store.hasBeenSeeded('empty-feed')).toBe(true);
    });

    it('keeps the cache validators already saved', () => {
      store.saveValidators('f', { etag: '"v1"' });
      store.seed('f', ['a']);

      expect(store.getValidators('f')).toEqual({ etag: '"v1"' });
    });
  });

  describe('cache validators', () => {
    it('is empty for an unknown feed', () => {
      expect(store.getValidators('f')).toEqual({});
    });

    it('saves and replaces them', () => {
      store.saveValidators('f', {
        etag: '"v1"',
        lastModified: 'Mon, 19 Oct 2026 10:00:00 GMT',
      });
      store.saveValidators('f', { etag: '"v2"' });

      expect(store.getValidators('f')).toEqual({ etag: '"v2"' });
    });

    it('does not reset the seed', () => {
      store.seed('f', []);
      store.saveValidators('f', { etag: '"v1"' });

      expect(store.hasBeenSeeded('f')).toBe(true);
    });
  });

  describe('persistence and schema', () => {
    it('keeps everything across a restart', () => {
      store.seed('f', ['a']);
      store.saveValidators('f', { etag: '"v1"' });
      store.close();

      store = openStore();

      expect(store.hasBeenSeeded('f')).toBe(true);
      expect(store.isSeen('f', 'a')).toBe(true);
      expect(store.getValidators('f')).toEqual({ etag: '"v1"' });
    });

    it('records the applied migrations once', () => {
      store.close();
      store = openStore();

      const db = new DatabaseSync(join(dataDir, DB_FILE_NAME));
      const rows = db.prepare('SELECT version FROM schema_migrations').all();
      db.close();
      expect(rows.map((row) => row.version)).toEqual(
        MIGRATIONS.map((_, i) => i + 1),
      );
    });

    it('refuses a database created by a newer feedhook', () => {
      store.close();
      const db = new DatabaseSync(join(dataDir, DB_FILE_NAME));
      db.prepare(
        'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
      ).run(999, new Date().toISOString());
      db.close();

      expect(() => openStore()).toThrow(/newer than this feedhook/);
    });

    it('creates the data directory, readable only by its owner', () => {
      const nested = join(dataDir, 'a', 'b');
      const other = openStore(nested);

      expect(statSync(nested).mode & 0o777).toBe(0o700);
      other.close();
    });

    it('fails clearly when used before open()', () => {
      const closed = new StoreService(configFor(dataDir));

      expect(() => closed.isSeen('f', 'a')).toThrow(/not open/);
    });
  });

  it('opens and closes with StoreModule', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [StoreModule] })
      .useMocker((token) =>
        token === AppConfig ? configFor(dataDir) : undefined,
      )
      .compile();
    await moduleRef.init();

    moduleRef.get(StoreService).markSeen('f', ['a']);
    await moduleRef.close();

    expect(() => moduleRef.get(StoreService).isSeen('f', 'a')).toThrow(
      /not open/,
    );
  });
});
