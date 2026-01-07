import { Redis, type RedisOptions } from 'ioredis';
import { retry } from '../core/index.mts';
import { defineAllScripts, type ERedis } from './scripts.mts';

const withRetry = retry((e) => e instanceof Error && e.message === 'transient error');

export class RedisConnectionPool {
  /** @internal */ private readonly _url: string;
  /** @internal */ private readonly _options: RedisOptions;
  /** @internal */ private readonly _maxConnections: number;
  /** @internal */ private readonly _connections: ERedis[] = [];
  /** @internal */ private _inUse = 0;
  /** @internal */ private _queue: ((client: ERedis) => void)[] = [];
  /** @internal */ private _closingFn?: () => void;
  /** @internal */ private _closed = false;

  constructor(url: string, options: RedisOptions, maxConnections: number) {
    this._url = url;
    this._options = options;
    this._maxConnections = maxConnections;
  }

  async withConnection<T>(
    fn: (c: ERedis) => Promise<T> | T,
    teardown?: (c: ERedis) => Promise<void> | void,
  ): Promise<T> {
    const c = await this._getConnection();
    try {
      return await fn(c);
    } finally {
      await teardown?.(c);
      this._returnConnection(c);
    }
  }

  async *withConnectionGen<T>(
    fn: (c: ERedis) => AsyncGenerator<T, void, undefined>,
    teardown?: (c: ERedis) => Promise<void> | void,
  ): AsyncGenerator<T, void, undefined> {
    const c = await this._getConnection();
    try {
      yield* fn(c);
    } finally {
      await teardown?.(c);
      this._returnConnection(c);
    }
  }

  retryWithConnection<T>(
    fn: (c: ERedis) => Promise<T> | T,
    teardown?: (c: ERedis) => Promise<void> | void,
  ): Promise<T> {
    return withRetry.promise(() => this.withConnection(fn, teardown));
  }

  retryWithConnectionGen<T>(
    fn: (c: ERedis) => AsyncGenerator<T, void, undefined>,
    teardown?: (c: ERedis) => Promise<void> | void,
  ): AsyncGenerator<T, void, undefined> {
    return withRetry.generator(() => this.withConnectionGen(fn, teardown));
  }

  close(): Promise<void> {
    if (this._closed) {
      return Promise.resolve();
    }

    this._closed = true;
    if (this._inUse === 0) {
      this._doClose();
      return Promise.resolve();
    }

    return new Promise((resolve): void => {
      this._closingFn = (): void => {
        this._doClose();
        resolve();
      };
    });
  }

  /** @internal */ private _doClose(): void {
    this._connections.forEach((c) => c.disconnect());
    this._connections.length = 0;
  }

  /** @internal */ private async _getConnection(): Promise<ERedis> {
    if (this._closed) {
      throw new Error('Connection _closed');
    }

    const r = this._connections.pop();
    if (r) {
      ++this._inUse;
      return r;
    }
    if (this._inUse < this._maxConnections) {
      ++this._inUse;
      const client = new Redis(this._url, this._options);
      client.on('error', () => {}); // remove default handling (errors are handled by callers)
      await client.connect();
      return defineAllScripts(client);
    }
    return new Promise((resolve): void => {
      this._queue.push(resolve);
    });
  }

  /** @internal */ private _returnConnection(c: ERedis): void {
    const q = this._queue.shift();
    if (q) {
      q(c);
    } else {
      this._inUse -= 1;
      this._connections.push(c);
      if (this._inUse === 0) {
        this._closingFn?.();
      }
    }
  }
}
