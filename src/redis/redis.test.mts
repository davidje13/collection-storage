import { RedisDB } from './RedisDB.mts';
import { contract } from '../test-helpers/db.contract-test.mts';

const url = process.env['REDIS_URL'] || 'redis://localhost:6379/15';

describe('RedisDB', () => {
  beforeAll(async () => {
    const db = await RedisDB.connect(url);
    await db.getConnectionPool().withConnection((c) => c.flushdb());
    await db.close();
  });

  contract({
    factory: () => RedisDB.connect(url),
    testMigration: false, // index migrations are not currently supported by the Redis integration
  });
});
