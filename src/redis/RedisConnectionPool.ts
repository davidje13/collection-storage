import IORedis from 'ioredis';
import defineAllScripts, { ERedis } from './scripts';
import retry from '../helpers/retry';

type RS = new(host?: string, options?: IORedis.RedisOptions) => IORedis.Redis;

const withRetry = retry((e) => (
  typeof e === 'object' &&
  e.message === 'transient error'
));

export default class RedisConnectionPool {
  private readonly connections: ERedis[] = [];

  private inUse: number = 0;

  private queue: ((client: ERedis) => void)[] = [];

  public constructor(
    private readonly RedisStatic: RS,
    private readonly url: string,
    private readonly options: IORedis.RedisOptions,
    private readonly maxConnections: number,
  ) {}

  public async withConnection<T>(
    fn: (c: ERedis) => Promise<T> | T,
    teardown?: (c: ERedis) => Promise<void> | void,
  ): Promise<T> {
    const c = await this.getConnection();
    try {
      return await fn(c);
    } finally {
      if (teardown) {
        await teardown(c);
      }
      this.returnConnection(c);
    }
  }

  public async retryWithConnection<T>(
    fn: (c: ERedis) => Promise<T> | T,
    teardown?: (c: ERedis) => Promise<void> | void,
  ): Promise<T> {
    return withRetry(() => this.withConnection(fn, teardown));
  }

  private async getConnection(): Promise<ERedis> {
    const r = this.connections.pop();
    if (r) {
      this.inUse += 1;
      return r;
    }
    if (this.inUse < this.maxConnections) {
      this.inUse += 1;
      const client = new this.RedisStatic(this.url, this.options);
      await client.connect();
      return defineAllScripts(client);
    }
    return new Promise((resolve): void => {
      this.queue.push(resolve);
    });
  }

  private returnConnection(c: ERedis): void {
    const q = this.queue.shift();
    if (q) {
      q(c);
    } else {
      this.inUse -= 1;
      this.connections.push(c);
    }
  }
}