import PostgresCollection from './PostgresCollection';
import DB, { DBKeys } from '../interfaces/DB';
import IDable from '../interfaces/IDable';

export default class PostgresDb implements DB {
  private readonly stateRef = { closed: false };

  private constructor(
    private readonly pool: import('pg').Pool,
  ) {}

  public static async connect(url: string): Promise<PostgresDb> {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: url });
    await pool.query('CREATE EXTENSION IF NOT EXISTS hstore');
    return new PostgresDb(pool);
  }

  public getCollection<T extends IDable>(
    name: string,
    keys?: DBKeys<T>,
  ): PostgresCollection<T> {
    return new PostgresCollection(this.pool, name, keys, this.stateRef);
  }

  public close(): Promise<void> {
    if (this.stateRef.closed) {
      return Promise.resolve();
    }
    this.stateRef.closed = true;
    return this.pool.end();
  }

  public getConnectionPool(): import('pg').Pool {
    return this.pool;
  }
}
