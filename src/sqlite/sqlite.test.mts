import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { versionIsGreaterOrEqual } from '../test-helpers/versionIsGreaterOrEqual.mts';
import { contract, migrationContract } from '../test-helpers/db.contract-test.mts';
import { makeWrappedDB } from '../test-helpers/makeWrappedDB.mts';
import { cache, compress, encryptByKey, type IDable } from '../core/index.mts';

assume(process.version, versionIsGreaterOrEqual('22.13'));

const { SQLiteDB } = await import('./SQLiteDB.mts');

describe('SQLiteDB contract', () => {
  contract({ factory: () => SQLiteDB.connect('sqlite://') });
});

describe('SQLiteDB migration contract', () => {
  let tempDir: string;
  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'cs-sqlite-'));
    if (!tempDir) {
      throw new Error('failed to create temp dir for SQLite databases');
    }
    return () => rm(tempDir, { recursive: true });
  });

  let unique = 0;

  migrationContract({
    factory: () => {
      const url = `sqlite://${join(tempDir, `db-${unique++}`)}`;
      return () => SQLiteDB.connect(url);
    },
  });
});

describe('SQLiteDB cached', () => {
  contract({
    factory: () =>
      makeWrappedDB(SQLiteDB.connect('sqlite://'), (base) =>
        cache(base, { capacity: 10, maxAge: 5000 }),
      ),
  });
});

describe('SQLiteDB compressed', () => {
  contract({
    factory: () =>
      makeWrappedDB(SQLiteDB.connect('sqlite://'), (base) => compress(['value'], base)),
  });
});

describe('SQLiteDB encrypted', () => {
  const enc = encryptByKey(randomBytes(32));

  contract({
    factory: async () =>
      makeWrappedDB(SQLiteDB.connect('sqlite://'), (base) =>
        enc<IDable & Record<string, unknown>>()(['value'], base),
      ),
  });
});
