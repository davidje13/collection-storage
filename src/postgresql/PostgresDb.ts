import type { Pool as PgPoolT } from 'pg';
import PostgresCollection from './PostgresCollection';
import type { DBKeys } from '../interfaces/DB';
import BaseDB from '../interfaces/BaseDB';
import type { IDable } from '../interfaces/IDable';

export default class PostgresDb extends BaseDB {
  private constructor(
    private readonly pool: PgPoolT,
  ) {
    super((name, keys) => new PostgresCollection(pool, name, keys, this.stateRef));
  }

  public static async connect(url: string): Promise<PostgresDb> {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: url });
    await pool.query('CREATE EXTENSION IF NOT EXISTS hstore');
    return new PostgresDb(pool);
  }

  public getCollection<T extends IDable>(name: string, keys?: DBKeys<T>): PostgresCollection<T> {
    return super.getCollection(name, keys) as PostgresCollection<T>;
  }

  public getConnectionPool(): PgPoolT {
    return this.pool;
  }

  protected internalClose(): Promise<void> {
    return this.pool.end();
  }
}
