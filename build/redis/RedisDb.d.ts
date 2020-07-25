import RedisCollection from './RedisCollection';
import type { DBKeys } from '../interfaces/DB';
import BaseDB from '../interfaces/BaseDB';
import type { IDable } from '../interfaces/IDable';
import RedisConnectionPool from './RedisConnectionPool';
export default class RedisDb extends BaseDB {
    private readonly pool;
    private constructor();
    static connect(url: string): Promise<RedisDb>;
    getCollection<T extends IDable>(name: string, keys?: DBKeys<T>): RedisCollection<T>;
    getConnectionPool(): RedisConnectionPool;
    protected internalClose(): Promise<void>;
}
//# sourceMappingURL=RedisDb.d.ts.map