import RedisDb from './RedisDb';
import contract from '../db.contract-test';

const url = process.env.REDIS_URL || 'redis://localhost:6379/15';

describe('RedisDb', () => contract({
  factory: async (): Promise<RedisDb> => {
    const db = await RedisDb.connect(url);
    await db.getConnectionPool().withConnection((c) => c.flushdb());
    return db;
  },
}));
