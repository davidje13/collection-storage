import RedisCollection from './RedisCollection';
import type { DBKeys } from '../interfaces/DB';
import BaseDB from '../interfaces/BaseDB';
import type { IDable } from '../interfaces/IDable';
import RedisConnectionPool from './RedisConnectionPool';

export default class RedisDb extends BaseDB {
  private constructor(
    private readonly pool: RedisConnectionPool,
  ) {
    super((name, keys) => new RedisCollection(this.pool, name, keys));
  }

  public static async connect(url: string): Promise<RedisDb> {
    const { default: RedisStatic } = await import('ioredis');
    // The built in reply transformer can only be disabled globally :(
    // See https://github.com/luin/ioredis/issues/1267
    RedisStatic.Command.setReplyTransformer('hgetall', (x) => x);
    const connectionPoolSize = 5;
    return new RedisDb(new RedisConnectionPool(
      RedisStatic,
      url,
      { lazyConnect: true },
      connectionPoolSize,
    ));
  }

  public getCollection<T extends IDable>(name: string, keys?: DBKeys<T>): RedisCollection<T> {
    return super.getCollection(name, keys) as RedisCollection<T>;
  }

  public getConnectionPool(): RedisConnectionPool {
    return this.pool;
  }

  protected internalClose(): Promise<void> {
    return this.pool.close();
  }
}
