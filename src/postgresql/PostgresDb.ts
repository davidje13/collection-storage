import { Pool as PPool } from 'pg';
import PostgresCollection from './PostgresCollection';
import DB, { DBKeys } from '../interfaces/DB';
import IDable from '../interfaces/IDable';

export default class PostgresDb implements DB {
  private closed = false;

  private constructor(
    private readonly pool: PPool,
  ) {}

  public static async connect(url: string): Promise<PostgresDb> {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: url });
    return new PostgresDb(pool);
  }

  public getCollection<T extends IDable>(
    name: string,
    keys?: DBKeys<T>,
  ): PostgresCollection<T> {
    return new PostgresCollection(this.pool, name, keys);
  }

  public close(): Promise<void> {
    if (this.closed) {
      return Promise.resolve();
    }
    this.closed = true;
    return this.pool.end();
  }

  public getConnectionPool(): PPool {
    return this.pool;
  }
}
