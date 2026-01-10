import { Pool } from 'pg';
import { type DBKeys, BaseDB, type IDable } from '../core/index.mts';
import { PostgresCollection } from './PostgresCollection.mts';

export class PostgresDB extends BaseDB {
  /** @internal */ declare private readonly _pool: Pool;

  private constructor(pool: Pool) {
    super();
    this._pool = pool;
  }

  static async connect(url: string): Promise<PostgresDB> {
    const pool = new Pool({ connectionString: url });
    await pool.query('CREATE EXTENSION IF NOT EXISTS hstore');
    return new PostgresDB(pool);
  }

  override getCollection<T extends IDable>(name: string, keys?: DBKeys<T>): PostgresCollection<T> {
    return this.get(name, keys, (options) => new PostgresCollection(options, this._pool));
  }

  getConnectionPool(): Pool {
    return this._pool;
  }

  /** @internal */ protected override internalClose(): Promise<void> {
    return this._pool.end();
  }
}
