import IORedis from 'ioredis';
import { ERedis } from './scripts';
declare type RS = new (host?: string, options?: IORedis.RedisOptions) => IORedis.Redis;
export default class RedisConnectionPool {
    private readonly RedisStatic;
    private readonly url;
    private readonly options;
    private readonly maxConnections;
    private readonly connections;
    private inUse;
    private queue;
    constructor(RedisStatic: RS, url: string, options: IORedis.RedisOptions, maxConnections: number);
    withConnection<T>(fn: (c: ERedis) => Promise<T> | T, teardown?: (c: ERedis) => Promise<void> | void): Promise<T>;
    retryWithConnection<T>(fn: (c: ERedis) => Promise<T> | T, teardown?: (c: ERedis) => Promise<void> | void): Promise<T>;
    private getConnection;
    private returnConnection;
}
export {};
