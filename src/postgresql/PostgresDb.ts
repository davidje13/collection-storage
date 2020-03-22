import type { Pool as PgPoolT } from 'pg';
import PostgresCollection from './PostgresCollection';
import type { DB, DBKeys } from '../interfaces/DB';
import type { IDable } from '../interfaces/IDable';

export default class PostgresDb implements DB {
  private readonly stateRef = { closed: false };

  private constructor(
    private readonly pool: PgPoolT,
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

  public getConnectionPool(): PgPoolT {
    return this.pool;
  }
}
