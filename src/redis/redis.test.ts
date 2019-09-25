import { Redis } from 'ioredis';
import RedisDb from './RedisDb';
import contract from '../db.contract-test';

const url = process.env.REDIS_URL || 'redis://localhost:6379/15';

describe('RedisDb', () => contract({
  factory: async (): Promise<RedisDb> => {
    const db = await RedisDb.connect(url);
    const client = ((db as any).client as Redis);
    await client.flushdb();
    return db;
  },
}));
