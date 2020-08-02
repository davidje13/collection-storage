import type { Pool as PgPoolT, QueryArrayResult as PgQueryArrayResultT } from 'pg';
import type { IDable } from '../interfaces/IDable';
import BaseCollection from '../interfaces/BaseCollection';
import type { DBKeys } from '../interfaces/DB';
import type { StateRef } from '../interfaces/BaseDB';
import { serialiseValue, deserialiseValue, serialiseRecord } from '../helpers/serialiser';
import { encodeHStore, decodeHStore } from './hstore';
import { withIdentifiers, quoteValue } from './sql';

const STATEMENTS = {
  CREATE_TABLE: [
    'CREATE TABLE IF NOT EXISTS $T (',
    'id TEXT NOT NULL PRIMARY KEY,',
    'data HSTORE NOT NULL',
    ')',
  ].join(''),

  GET_INDEX_NAMES: 'SELECT indexname FROM pg_indexes WHERE tablename=$1 AND schemaname=current_schema()',

  CREATE_INDEX: 'CREATE INDEX IF NOT EXISTS $I ON $T USING HASH ((data->$1))',
  CREATE_UNIQUE_INDEX: 'CREATE UNIQUE INDEX IF NOT EXISTS $I ON $T ((data->$1))',
  DROP_INDEX: 'DROP INDEX IF EXISTS $I',

  INSERT: 'INSERT INTO $T (id, data) VALUES ($1, $2::hstore)',

  UPDATE: 'UPDATE $T SET data=data||$1::hstore WHERE data->$2=$3 RETURNING id',
  UPDATE_ID: 'UPDATE $T SET data=data||$1::hstore WHERE id=$2',

  UPSERT_ID: 'INSERT INTO $T (id, data) VALUES ($1, $2::hstore) ON CONFLICT (id) DO UPDATE SET data=$T.data||$2::hstore',

  SELECT_ONE: 'SELECT id, data FROM $T WHERE data->$1=$2 LIMIT 1',
  SELECT_ALL: 'SELECT id, data FROM $T',
  SELECT_ALL_BY: 'SELECT id, data FROM $T WHERE data->$1=$2',
  SELECT_ID: 'SELECT id, data FROM $T WHERE id=$1',

  DELETE: 'DELETE FROM $T WHERE data->$1=$2',
  DELETE_ID: 'DELETE FROM $T WHERE id=$1',
};

async function configureTable(
  pool: PgPoolT,
  tableName: string,
  keys: DBKeys<any> = {},
): Promise<void> {
  const c = await pool.connect();
  try {
    /* eslint-disable no-await-in-loop */ // client cannot multitask

    await c.query(withIdentifiers(STATEMENTS.CREATE_TABLE, {
      T: tableName,
    }));

    const indices = await c.query({
      rowMode: 'array',
      text: STATEMENTS.GET_INDEX_NAMES,
      values: [tableName],
    });
    const oldIndexNames = new Set(
      indices.rows
        .map((r) => r[0])
        .filter((i) => (i.startsWith(`${tableName}_i`) || i.startsWith(`${tableName}_u`))),
    );

    // PostgreSQL does not support prepared statements for CREATE statements,
    // so we must escape the values manually using quoteValue.
    const keyEntries = Object.entries(keys);
    for (let i = 0; i < keyEntries.length; i += 1) {
      const [k, v] = keyEntries[i];
      if (v && v.unique) {
        const name = `${tableName}_u${k}`;
        if (!oldIndexNames.delete(name)) {
          await c.query(withIdentifiers(STATEMENTS.CREATE_UNIQUE_INDEX, {
            T: tableName,
            I: name,
          }).replace(/\$1/g, quoteValue(k)));
        }
      } else {
        const name = `${tableName}_i${k}`;
        if (!oldIndexNames.delete(name)) {
          await c.query(withIdentifiers(STATEMENTS.CREATE_INDEX, {
            T: tableName,
            I: name,
          }).replace(/\$1/g, quoteValue(k)));
        }
      }
    }
    const indicesToDelete = [...oldIndexNames];
    for (let i = 0; i < indicesToDelete.length; i += 1) {
      const idx = indicesToDelete[i];
      await c.query(withIdentifiers(STATEMENTS.DROP_INDEX, {
        T: tableName,
        I: idx,
      }));
    }

    /* eslint-enable no-await-in-loop */
  } finally {
    c.release();
  }
}

function toHStore(record: Record<string, unknown>): string {
  return encodeHStore(serialiseRecord(record));
}

function fromHStore<T>(
  [id, data]: readonly any[],
  fields?: readonly string[],
): T {
  const rawMap = decodeHStore(data);
  rawMap.id = id;

  const result: Record<string, unknown> = {};

  if (!fields) {
    Object.entries(rawMap).forEach(([k, v]) => {
      result[k] = deserialiseValue(v);
    });
    return result as T;
  }

  fields.forEach((f) => {
    result[f] = deserialiseValue(rawMap[f]);
  });
  return result as T;
}

export default class PostgresCollection<T extends IDable> extends BaseCollection<T> {
  private readonly cachedQueries: Partial<Record<keyof typeof STATEMENTS, string>> = {};

  public constructor(
    private readonly pool: PgPoolT,
    private readonly tableName: string,
    keys: DBKeys<T> = {},
    private readonly stateRef: StateRef = { closed: false },
  ) {
    super(keys);

    this.initAsync(configureTable(pool, tableName, keys));
  }

  protected async internalAdd({ id, ...rest }: T): Promise<void> {
    await this.runTableQuery('INSERT', serialiseValue(id), toHStore(rest));
  }

  protected async internalUpsert(
    id: T['id'],
    update: Partial<T>,
  ): Promise<void> {
    await this.runTableQuery('UPSERT_ID', serialiseValue(id), toHStore(update));
  }

  protected async internalUpdate<K extends keyof T & string>(
    searchAttribute: K,
    searchValue: T[K],
    { id, ...rest }: Partial<T>,
  ): Promise<void> {
    const sId = serialiseValue(searchValue);
    const hstore = toHStore(rest);

    if (searchAttribute === 'id') {
      await this.runTableQuery('UPDATE_ID', hstore, sId);
    } else {
      const r = await this.runTableQuery('UPDATE', hstore, searchAttribute, sId);
      if (id !== undefined && r.rowCount > 0 && r.rows[0][0] !== id) {
        throw new Error('Cannot update ID');
      }
    }
  }

  protected async internalGet<
    K extends keyof T & string,
    F extends readonly (keyof T & string)[]
  >(
    searchAttribute: K,
    searchValue: T[K],
    returnAttributes?: F,
  ): Promise<Readonly<Pick<T, F[-1]>> | null> {
    let raw;
    if (searchAttribute === 'id') {
      raw = await this.runTableQuery('SELECT_ID', serialiseValue(searchValue));
    } else {
      raw = await this.runTableQuery('SELECT_ONE', searchAttribute, serialiseValue(searchValue));
    }
    if (!raw.rowCount) {
      return null;
    }
    return fromHStore<T>(raw.rows[0], returnAttributes);
  }

  protected async internalGetAll<
    K extends keyof T & string,
    F extends readonly (keyof T & string)[]
  >(
    searchAttribute?: K,
    searchValue?: T[K],
    returnAttributes?: F,
  ): Promise<Readonly<Pick<T, F[-1]>>[]> {
    let raw;
    if (!searchAttribute) {
      raw = await this.runTableQuery('SELECT_ALL');
    } else if (searchAttribute === 'id') {
      raw = await this.runTableQuery('SELECT_ID', serialiseValue(searchValue));
    } else {
      raw = await this.runTableQuery('SELECT_ALL_BY', searchAttribute, serialiseValue(searchValue));
    }
    return raw.rows.map((v) => fromHStore<T>(v, returnAttributes));
  }

  protected async internalRemove<K extends keyof T & string>(
    searchAttribute: K,
    searchValue: T[K],
  ): Promise<number> {
    let raw;
    if (searchAttribute === 'id') {
      raw = await this.runTableQuery('DELETE_ID', serialiseValue(searchValue));
    } else {
      raw = await this.runTableQuery('DELETE', searchAttribute, serialiseValue(searchValue));
    }
    return raw.rowCount;
  }

  private runTableQuery(
    queryName: keyof typeof STATEMENTS,
    ...values: any[]
  ): Promise<PgQueryArrayResultT<any[]>> {
    if (this.stateRef.closed) {
      throw new Error('Connection closed');
    }

    let cached = this.cachedQueries[queryName];
    if (!cached) {
      cached = withIdentifiers(STATEMENTS[queryName], { T: this.tableName });
      this.cachedQueries[queryName] = cached;
    }

    return this.pool.query({
      name: `${this.tableName}_${queryName}`,
      rowMode: 'array',
      text: cached,
      values,
    });
  }
}
