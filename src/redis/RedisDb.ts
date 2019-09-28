import RedisCollection from './RedisCollection';
import DB, { DBKeys } from '../interfaces/DB';
import IDable from '../interfaces/IDable';
import RedisConnectionPool from './RedisConnectionPool';

export default class RedisDb implements DB {
  private constructor(
    private readonly pool: RedisConnectionPool,
  ) {}

  public static async connect(url: string): Promise<RedisDb> {
    const { default: RedisStatic } = await import('ioredis');
    const connectionPoolSize = 5;
    return new RedisDb(new RedisConnectionPool(
      RedisStatic,
      url,
      { lazyConnect: true },
      connectionPoolSize,
    ));
  }

  public getCollection<T extends IDable>(
    name: string,
    keys?: DBKeys<T>,
  ): RedisCollection<T> {
    return new RedisCollection(this.pool, name, keys);
  }

  public getConnectionPool(): RedisConnectionPool {
    return this.pool;
  }
}
