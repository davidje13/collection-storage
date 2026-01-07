import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { versionIsGreaterOrEqual } from '../test-helpers/versionIsGreaterOrEqual.mts';
import { contract } from '../test-helpers/db.contract-test.mts';

describe('SQLiteDB', async () => {
  assume(process.version, versionIsGreaterOrEqual('22.13'));

  const { SQLiteDB } = await import('./SQLiteDB.mts');

  let tempDir: string;
  let unique = 0;
  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'cs-sqlite-'));
    if (!tempDir) {
      throw new Error('failed to create temp dir for SQLite databases');
    }
    return () => rm(tempDir, { recursive: true });
  });

  contract({
    factory: (persist) => {
      const url = persist ? `sqlite://${join(tempDir, `db-${unique++}`)}` : 'sqlite://';
      return SQLiteDB.connect(url);
    },
    migrationFactory: (existing) => SQLiteDB.connect('sqlite://' + existing.getFilePath()),
  });
});
