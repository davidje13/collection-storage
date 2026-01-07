import { type DBKeys, BaseDB, type IDable } from 'collection-storage';
import { Command } from 'ioredis';
import { RedisCollection } from './RedisCollection.mts';
import { RedisConnectionPool } from './RedisConnectionPool.mts';

export class RedisDB extends BaseDB {
  /** @internal */ private readonly _pool: RedisConnectionPool;

  /** @internal */ private constructor(pool: RedisConnectionPool) {
    super();
    this._pool = pool;
  }

  static async connect(url: string): Promise<RedisDB> {
    // The built in reply transformer can only be disabled globally :(
    // See https://github.com/luin/ioredis/issues/1267
    Command.setReplyTransformer('hgetall', (x) => x);
    const connectionPoolSize = 5;
    return new RedisDB(new RedisConnectionPool(url, { lazyConnect: true }, connectionPoolSize));
  }

  override getCollection<T extends IDable>(name: string, keys?: DBKeys<T>): RedisCollection<T> {
    return this.get(name, keys, (options) => new RedisCollection(options, this._pool));
  }

  getConnectionPool() {
    return this._pool;
  }

  /** @internal */ protected override internalClose() {
    return this._pool.close();
  }
}
