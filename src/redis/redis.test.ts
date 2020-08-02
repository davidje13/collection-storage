import RedisDb from './RedisDb';
import contract from '../db.contract-test';

const url = process.env.REDIS_URL || 'redis://localhost:6379/15';

describe('RedisDb', () => contract({
  beforeAll: async (): Promise<void> => {
    const db = await RedisDb.connect(url);
    await db.getConnectionPool().withConnection((c) => c.flushdb());
    await db.close();
  },
  factory: (): Promise<RedisDb> => RedisDb.connect(url),
  testMigration: false, // index migrations are not currently supported by the Redis integration
}));
