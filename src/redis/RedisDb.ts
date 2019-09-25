import { Redis } from 'ioredis';
import RedisCollection from './RedisCollection';
import DB, { DBKeys } from '../interfaces/DB';
import IDable from '../interfaces/IDable';

export default class RedisDb implements DB {
  private constructor(
    private readonly client: Redis,
  ) {}

  public static async connect(url: string): Promise<RedisDb> {
    const { default: RedisStatic } = await import('ioredis');
    const client = new RedisStatic(url, { lazyConnect: true });
    await client.connect();
    return new RedisDb(client);
  }

  public getCollection<T extends IDable>(
    name: string,
    keys?: DBKeys<T>,
  ): RedisCollection<T> {
    return new RedisCollection(this.client, name, keys);
  }
}
