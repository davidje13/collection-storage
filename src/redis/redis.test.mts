import { randomBytes } from 'node:crypto';
import { RedisDB } from './RedisDB.mts';
import { contract, migrationContract } from '../test-helpers/db.contract-test.mts';
import { makeWrappedDB } from '../test-helpers/makeWrappedDB.mts';
import { cache, compress, encryptByKey, type IDable } from '../core/index.mts';

const url = process.env['REDIS_URL'] || 'redis://localhost:6379/15';

beforeAll(async () => {
  const db = RedisDB.connect(url);
  await db.getConnectionPool().withConnection((c) => c.flushdb());
  await db.close();
});

describe('RedisDB contract', () => {
  contract({ factory: () => RedisDB.connect(url) });
});

// index migrations are not currently supported by the Redis integration
describe.ignore('RedisDB migration contract', () => {
  migrationContract({ factory: () => () => RedisDB.connect(url) });
});

describe('RedisDB cached', () => {
  contract({
    factory: async () =>
      makeWrappedDB(RedisDB.connect(url), (base) => cache(base, { capacity: 10, maxAge: 5000 })),
  });
});

describe('RedisDB compressed', () => {
  contract({
    factory: async () => makeWrappedDB(RedisDB.connect(url), (base) => compress(['value'], base)),
  });
});

describe('RedisDB encrypted', () => {
  const enc = encryptByKey(randomBytes(32));

  contract({
    factory: async () =>
      makeWrappedDB(RedisDB.connect(url), (base) =>
        enc<IDable & Record<string, unknown>>()(['value'], base),
      ),
  });
});
