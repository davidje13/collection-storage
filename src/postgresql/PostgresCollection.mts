import type { Pool as PgPoolT, QueryArrayResult as PgQueryArrayResultT } from 'pg';
import {
  type IDable,
  BaseCollection,
  type DBKeys,
  serialiseValue,
  serialiseRecord,
  partialDeserialiseRecord,
  type Serialised,
  type CollectionOptions,
} from '../core/index.mts';
import { encodeHStore, decodeHStore } from './hstore.mts';
import { withIdentifiers } from './sql.mts';

export class PostgresCollection<T extends IDable> extends BaseCollection<T> {
  /** @internal */ private readonly _pool: PgPoolT;
  /** @internal */ private readonly _tableName: string;
  /** @internal */ private readonly _cachedQueries = new Map<keyof typeof STATEMENTS, string>();

  constructor(options: CollectionOptions<T>, pool: PgPoolT) {
    super(options);
    this._pool = pool;
    this._tableName = options.name;

    this.initAsync(configureTable(pool, this._tableName, options.keys));
  }

  protected override async internalAddBatch(records: T[]) {
    for (const record of records) {
      const sRecord = serialiseRecord(record);
      const id = sRecord.get('id');
      sRecord.delete('id');
      await this._runTableQuery('INSERT', id, encodeHStore(sRecord));
    }
  }

  /** @internal */ protected override async internalUpsert(id: T['id'], update: Partial<T>) {
    await this._runTableQuery(
      'UPSERT_ID',
      serialiseValue(id),
      encodeHStore(serialiseRecord(update)),
    );
  }

  protected override async internalUpdate<K extends string & keyof T>(
    filterAttribute: K,
    filterValue: T[K],
    delta: Partial<T>,
  ) {
    const sValue = serialiseValue(filterValue);
    const sRecord = serialiseRecord(delta);
    const sId = sRecord.get('id');
    sRecord.delete('id');
    const hstore = encodeHStore(sRecord);

    if (filterAttribute === 'id') {
      await this._runTableQuery('UPDATE_ID', hstore, sValue);
    } else if (sId !== undefined) {
      try {
        await this._runTableQuery('UPDATE_IF_ID', hstore, filterAttribute, sValue, sId);
      } catch (e) {
        if (e instanceof Error && e.message.includes('division by zero')) {
          // We use /0 to intentionally throw an error in UPDATE_IF_ID to distinguish between
          // the case of no records found to update, vs. found a record but did not match ID.
          // Being an error, it causes an automatic rollback of any other changes.
          // Nothing else can cause a /0 error in this statement.
          throw new Error('Cannot update ID');
        } else {
          throw e;
        }
      }
    } else {
      await this._runTableQuery('UPDATE', hstore, filterAttribute, sValue);
    }
  }

  /** @internal */ protected override async internalGet<
    K extends string & keyof T,
    F extends readonly (string & keyof T)[],
  >(filterAttribute: K | undefined, filterValue: T[K] | undefined, returnAttributes?: F) {
    let raw: PgQueryArrayResultT<[string, string]>;
    if (!filterAttribute) {
      raw = await this._runTableQuery('SELECT_ANY_ONE');
    } else if (filterAttribute === 'id') {
      raw = await this._runTableQuery('SELECT_ID', serialiseValue(filterValue));
    } else {
      raw = await this._runTableQuery('SELECT_ONE', filterAttribute, serialiseValue(filterValue));
    }
    if (!raw.rowCount) {
      return null;
    }
    return fromHStore<T, F>(raw.rows[0]!, returnAttributes);
  }

  protected override async *internalGetAll<
    K extends string & keyof T,
    F extends readonly (string & keyof T)[],
  >(filterAttribute: K | undefined, filterValue: T[K] | undefined, returnAttributes?: F) {
    // TODO: ideally use cursors here to avoid loading all data into memory at once
    // https://www.postgresql.org/docs/current/plpgsql-cursors.html
    let raw: PgQueryArrayResultT<[string, string]>;
    if (!filterAttribute) {
      raw = await this._runTableQuery('SELECT_ALL');
    } else if (filterAttribute === 'id') {
      raw = await this._runTableQuery('SELECT_ID', serialiseValue(filterValue));
    } else {
      raw = await this._runTableQuery(
        'SELECT_ALL_BY',
        filterAttribute,
        serialiseValue(filterValue),
      );
    }
    for (const row of raw.rows) {
      yield fromHStore<T, F>(row, returnAttributes);
    }
  }

  protected override async internalRemove<K extends string & keyof T>(
    filterAttribute: K | undefined,
    filterValue: T[K] | undefined,
  ) {
    let raw: PgQueryArrayResultT<[]>;
    if (!filterAttribute) {
      raw = await this._runTableQuery('DELETE_ALL');
    } else if (filterAttribute === 'id') {
      raw = await this._runTableQuery('DELETE_ID', serialiseValue(filterValue));
    } else {
      raw = await this._runTableQuery('DELETE', filterAttribute, serialiseValue(filterValue));
    }
    return raw.rowCount ?? 0;
  }

  /** @internal */ private _runTableQuery<R extends any[] = unknown[]>(
    queryName: keyof typeof STATEMENTS,
    ...values: unknown[]
  ): Promise<PgQueryArrayResultT<R>> {
    if (this.closed) {
      throw new Error('Connection closed');
    }

    let cached = this._cachedQueries.get(queryName);
    if (!cached) {
      cached = withIdentifiers(STATEMENTS[queryName], { T: this._tableName });
      this._cachedQueries.set(queryName, cached);
    }

    return this._pool.query({
      name: `${this._tableName}_${queryName}`,
      rowMode: 'array',
      text: cached,
      values,
    });
  }
}

const STATEMENTS = {
  CREATE_TABLE: 'CREATE TABLE IF NOT EXISTS $T (id TEXT NOT NULL PRIMARY KEY,data HSTORE NOT NULL)',

  GET_INDEX_NAMES:
    'SELECT indexname FROM pg_indexes WHERE tablename=$1 AND schemaname=current_schema()',

  CREATE_INDEX: 'CREATE INDEX IF NOT EXISTS $I ON $T USING HASH ((data->$K))',
  CREATE_UNIQUE_INDEX: 'CREATE UNIQUE INDEX IF NOT EXISTS $I ON $T ((data->$K))',
  DROP_INDEX: 'DROP INDEX IF EXISTS $I',

  INSERT: 'INSERT INTO $T (id,data) VALUES ($1,$2::hstore)',

  UPDATE: 'UPDATE $T SET data=data||$1::hstore WHERE data->$2=$3 RETURNING id',
  UPDATE_IF_ID:
    'UPDATE $T SET data=data||$1::hstore WHERE data->$2=$3 RETURNING CASE WHEN id<>$4 THEN LENGTH(id)/0 ELSE 1 END',
  UPDATE_ID: 'UPDATE $T SET data=data||$1::hstore WHERE id=$2',

  UPSERT_ID:
    'INSERT INTO $T (id,data) VALUES ($1,$2::hstore) ON CONFLICT (id) DO UPDATE SET data=$T.data||EXCLUDED.data',

  SELECT_ONE: 'SELECT id,data FROM $T WHERE data->$1=$2 LIMIT 1',
  SELECT_ANY_ONE: 'SELECT id,data FROM $T LIMIT 1',
  SELECT_ALL: 'SELECT id,data FROM $T',
  SELECT_ALL_BY: 'SELECT id,data FROM $T WHERE data->$1=$2',
  SELECT_ID: 'SELECT id,data FROM $T WHERE id=$1',

  DELETE: 'DELETE FROM $T WHERE data->$1=$2',
  DELETE_ALL: 'DELETE FROM $T',
  DELETE_ID: 'DELETE FROM $T WHERE id=$1',
};

async function configureTable(
  pool: PgPoolT,
  tableName: string,
  keys: DBKeys<any> = {},
): Promise<void> {
  const c = await pool.connect();
  try {
    await c.query(withIdentifiers(STATEMENTS.CREATE_TABLE, { T: tableName }));

    const indices = await c.query({
      rowMode: 'array',
      text: STATEMENTS.GET_INDEX_NAMES,
      values: [tableName],
    });
    const oldIndexNames = new Set(
      indices.rows
        .map((r) => r[0])
        .filter((i) => i.startsWith(`${tableName}_i`) || i.startsWith(`${tableName}_u`)),
    );

    // PostgreSQL does not support prepared statements for CREATE statements,
    // so we must escape the values manually using quoteValue.
    for (const [k, v] of Object.entries(keys)) {
      if (v && v.unique) {
        const name = `${tableName}_u${k}`;
        if (!oldIndexNames.delete(name)) {
          await c.query(
            withIdentifiers(STATEMENTS.CREATE_UNIQUE_INDEX, { T: tableName, I: name }, { K: k }),
          );
        }
      } else {
        const name = `${tableName}_i${k}`;
        if (!oldIndexNames.delete(name)) {
          await c.query(
            withIdentifiers(STATEMENTS.CREATE_INDEX, { T: tableName, I: name }, { K: k }),
          );
        }
      }
    }
    for (const idx of oldIndexNames) {
      await c.query(
        withIdentifiers(STATEMENTS.DROP_INDEX, {
          T: tableName,
          I: idx,
        }),
      );
    }
  } finally {
    c.release();
  }
}

function fromHStore<T extends object, F extends readonly (string & keyof T)[]>(
  [id, data]: [string, string],
  fields?: F,
): Pick<T, F[number]> {
  return partialDeserialiseRecord<T, F>(decodeHStore(data).set('id', id) as Serialised<T>, fields);
}
