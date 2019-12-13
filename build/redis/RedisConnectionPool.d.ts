import { ERedis } from './scripts';
declare type RedisOptions = import('ioredis').RedisOptions;
declare type Redis = import('ioredis').Redis;
declare type RS = new (host?: string, options?: RedisOptions) => Redis;
export default class RedisConnectionPool {
    private readonly RedisStatic;
    private readonly url;
    private readonly options;
    private readonly maxConnections;
    private readonly connections;
    private inUse;
    private queue;
    private closingFn?;
    private closed;
    constructor(RedisStatic: RS, url: string, options: RedisOptions, maxConnections: number);
    withConnection<T>(fn: (c: ERedis) => Promise<T> | T, teardown?: (c: ERedis) => Promise<void> | void): Promise<T>;
    retryWithConnection<T>(fn: (c: ERedis) => Promise<T> | T, teardown?: (c: ERedis) => Promise<void> | void): Promise<T>;
    close(): Promise<void>;
    private doClose;
    private getConnection;
    private returnConnection;
}
export {};
//# sourceMappingURL=RedisConnectionPool.d.ts.map