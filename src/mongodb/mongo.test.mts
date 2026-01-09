import { randomBytes } from 'node:crypto';
import { cache, compress, encryptByKey, type IDable } from '../core/index.mts';
import { contract, migrationContract } from '../test-helpers/db.contract-test.mts';
import { makeWrappedDB } from '../test-helpers/makeWrappedDB.mts';
import { MongoDB } from './MongoDB.mts';

const url = process.env['MONGO_URL'] || 'mongodb://localhost:27017/collection-storage-tests';

beforeAll(async () => {
  const db = await MongoDB.connect(url);
  await db.getDb().command({ dropDatabase: 1 });
  await db.close();
});

describe('MongoDB contract', () => {
  contract({ factory: () => MongoDB.connect(url) });
});

describe('MongoDB migration contract', () => {
  migrationContract({ factory: () => () => MongoDB.connect(url) });
});

describe('MongoDB cached', () => {
  contract({
    factory: async () =>
      makeWrappedDB(await MongoDB.connect(url), (base) =>
        cache(base, { capacity: 10, maxAge: 5000 }),
      ),
  });
});

describe('MongoDB compressed', () => {
  contract({
    factory: async () =>
      makeWrappedDB(await MongoDB.connect(url), (base) => compress(['value'], base)),
  });
});

describe('MongoDB encrypted', () => {
  const enc = encryptByKey(randomBytes(32));

  contract({
    factory: async () =>
      makeWrappedDB(await MongoDB.connect(url), (base) =>
        enc<IDable & Record<string, unknown>>()(['value'], base),
      ),
  });
});
