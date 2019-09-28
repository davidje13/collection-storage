import RedisCollection from './RedisCollection';
import DB, { DBKeys } from '../interfaces/DB';
import IDable from '../interfaces/IDable';
import RedisConnectionPool from './RedisConnectionPool';
export default class RedisDb implements DB {
    private readonly pool;
    private constructor();
    static connect(url: string): Promise<RedisDb>;
    getCollection<T extends IDable>(name: string, keys?: DBKeys<T>): RedisCollection<T>;
    getConnectionPool(): RedisConnectionPool;
}
