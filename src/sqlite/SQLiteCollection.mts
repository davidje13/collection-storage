import type { DatabaseSync, StatementResultingChanges, StatementSync } from 'node:sqlite';
import {
  type IDable,
  BaseCollection,
  type DBKeys,
  serialiseValue,
  serialiseRecord,
  type CollectionOptions,
  partialDeserialiseRecord,
  type Serialised,
} from '../core/index.mts';
import { withIdentifiers } from './sql.mts';

export class SQLiteCollection<T extends IDable> extends BaseCollection<T> {
  /** @internal */ private readonly _db: DatabaseSync;
  /** @internal */ private readonly _tableName: string;
  /** @internal */ private readonly _cachedQueries = new Map<
    keyof typeof STATEMENTS,
    StatementSync
  >();

  /** @internal */ constructor(options: CollectionOptions<T>, db: DatabaseSync) {
    super(options);
    this._db = db;
    this._tableName = options.name;

    configureTable(db, this._tableName, options.keys);
  }

  protected override internalAddBatch(records: T[]) {
    for (const record of records) {
      const sRecord = serialiseRecord(record);
      const sId = sRecord.get('id');
      if (!sId) {
        throw new Error('Missing ID in inserted record');
      }
      sRecord.delete('id');
      try {
        this._tableQuery('INSERT').run(sId, toDB(sRecord));
      } catch (err: unknown) {
        convertError(err);
      }
    }
  }

  /** @internal */ protected override internalUpsert(id: T['id'], update: Partial<T>) {
    try {
      this._tableQuery('UPSERT_ID').run(serialiseValue(id), toDB(serialiseRecord(update)));
    } catch (err: unknown) {
      convertError(err);
    }
  }

  protected override internalUpdate<K extends string & keyof T>(
    filterAttribute: K,
    filterValue: T[K],
    delta: Partial<T>,
  ) {
    const sValue = serialiseValue(filterValue);
    const sDelta = serialiseRecord(delta);
    const sId = sDelta.get('id');
    sDelta.delete('id');
    const data = toDB(sDelta);

    try {
      if (filterAttribute === 'id') {
        this._tableQuery('UPDATE_ID').run(data, sValue);
      } else if (sId !== undefined) {
        this._tableQuery('UPDATE_IF_ID').run(sId, data, toJSONPath(filterAttribute), sValue);
      } else {
        this._tableQuery('UPDATE').run(data, toJSONPath(filterAttribute), sValue);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('NOT NULL constraint failed')) {
        // We insert NULL to intentionally throw an error in UPDATE_IF_ID to distinguish between
        // the case of no records found to update, vs. found a record but did not match ID.
        // Being an error, it causes an automatic rollback of any other changes.
        // Nothing else can cause a NULL error in these statements statement.
        throw new Error('Cannot update ID');
      }
      convertError(err);
    }
  }

  /** @internal */ protected override async internalGet<
    K extends string & keyof T,
    F extends readonly (string & keyof T)[],
  >(filterAttribute: K | undefined, filterValue: T[K] | undefined, returnAttributes?: F) {
    let result: any;
    if (!filterAttribute) {
      result = this._tableQuery('SELECT_ANY_ONE').get();
    } else if (filterAttribute === 'id') {
      result = this._tableQuery('SELECT_ID').get(serialiseValue(filterValue));
    } else {
      result = this._tableQuery('SELECT_ONE').get(
        toJSONPath(filterAttribute),
        serialiseValue(filterValue),
      );
    }
    if (result === undefined) {
      return null;
    }
    return fromDB<T, F>(result, returnAttributes);
  }

  protected override *internalGetAll<
    K extends string & keyof T,
    F extends readonly (string & keyof T)[],
  >(filterAttribute: K | undefined, filterValue: T[K] | undefined, returnAttributes?: F) {
    let results: Iterator<any>;
    if (!filterAttribute) {
      results = this._tableQuery('SELECT_ALL').iterate();
    } else if (filterAttribute === 'id') {
      results = this._tableQuery('SELECT_ID').iterate(serialiseValue(filterValue));
    } else {
      results = this._tableQuery('SELECT_ALL_BY').iterate(
        toJSONPath(filterAttribute),
        serialiseValue(filterValue),
      );
    }
    for (const row of { [Symbol.iterator]: () => results }) {
      yield fromDB<T, F>(row, returnAttributes);
    }
  }

  protected override internalRemove<K extends string & keyof T>(
    filterAttribute: K | undefined,
    filterValue: T[K] | undefined,
  ) {
    let result: StatementResultingChanges;
    if (!filterAttribute) {
      result = this._tableQuery('DELETE_ALL').run();
    } else if (filterAttribute === 'id') {
      result = this._tableQuery('DELETE_ID').run(serialiseValue(filterValue));
    } else {
      result = this._tableQuery('DELETE').run(
        toJSONPath(filterAttribute),
        serialiseValue(filterValue),
      );
    }
    return result.changes as number;
  }

  /** @internal */ private _tableQuery(queryName: keyof typeof STATEMENTS): StatementSync {
    if (this.closed) {
      throw new Error('Connection closed');
    }

    let cached = this._cachedQueries.get(queryName);
    if (!cached) {
      cached = this._db.prepare(withIdentifiers(STATEMENTS[queryName], { T: this._tableName }));
      this._cachedQueries.set(queryName, cached);
    }
    return cached;
  }
}

// https://sqlite.org/lang.html
const STATEMENTS = {
  CREATE_TABLE:
    'CREATE TABLE IF NOT EXISTS $T (id TEXT NOT NULL PRIMARY KEY,data BLOB NOT NULL) STRICT',

  GET_INDEX_NAMES: 'SELECT name FROM pragma_index_list(?)',

  CREATE_INDEX: 'CREATE INDEX IF NOT EXISTS $I ON $T (data->>$K)',
  CREATE_UNIQUE_INDEX: 'CREATE UNIQUE INDEX IF NOT EXISTS $I ON $T (data->>$K)',
  DROP_INDEX: 'DROP INDEX IF EXISTS $I',

  INSERT: 'INSERT INTO $T (id,data) VALUES (?,jsonb(?))',

  UPDATE: 'UPDATE $T SET data=jsonb_patch(data,?) WHERE data->>?=? RETURNING id',
  UPDATE_IF_ID:
    'UPDATE $T SET data=CASE WHEN id=? THEN jsonb_patch(data,?) ELSE NULL END WHERE data->>?=?',
  UPDATE_ID: 'UPDATE $T SET data=jsonb_patch(data,?) WHERE id=?',

  UPSERT_ID:
    'INSERT INTO $T (id,data) VALUES (?,jsonb(?)) ON CONFLICT (id) DO UPDATE SET data=jsonb_patch(data,EXCLUDED.data)',

  SELECT_ONE: 'SELECT id,json(data) FROM $T WHERE data->>?=? LIMIT 1',
  SELECT_ANY_ONE: 'SELECT id,json(data) FROM $T LIMIT 1',
  SELECT_ALL: 'SELECT id,json(data) FROM $T',
  SELECT_ALL_BY: 'SELECT id,json(data) FROM $T WHERE data->>?=?',
  SELECT_ID: 'SELECT id,json(data) FROM $T WHERE id=?',

  DELETE: 'DELETE FROM $T WHERE data->>?=?',
  DELETE_ALL: 'DELETE FROM $T',
  DELETE_ID: 'DELETE FROM $T WHERE id=?',
};

function configureTable(db: DatabaseSync, tableName: string, keys: DBKeys<any> = {}) {
  db.exec(withIdentifiers(STATEMENTS.CREATE_TABLE, { T: tableName }));

  const indices = db.prepare(STATEMENTS.GET_INDEX_NAMES).all(tableName);
  const oldIndexNames = new Set(
    indices
      .map((r) => r[0] as string)
      .filter((i) => i.startsWith(`${tableName}_i`) || i.startsWith(`${tableName}_u`)),
  );

  // SQLite does not support prepared statements for CREATE INDEX statements,
  // so we must escape the values manually using quoteValue.
  for (const [k, v] of Object.entries(keys)) {
    if (v && v.unique) {
      const name = `${tableName}_u${k}`;
      if (!oldIndexNames.delete(name)) {
        db.exec(
          withIdentifiers(
            STATEMENTS.CREATE_UNIQUE_INDEX,
            { T: tableName, I: name },
            { K: toJSONPath(k) },
          ),
        );
      }
    } else {
      const name = `${tableName}_i${k}`;
      if (!oldIndexNames.delete(name)) {
        db.exec(
          withIdentifiers(STATEMENTS.CREATE_INDEX, { T: tableName, I: name }, { K: toJSONPath(k) }),
        );
      }
    }
  }
  for (const idx of oldIndexNames) {
    db.exec(
      withIdentifiers(STATEMENTS.DROP_INDEX, {
        T: tableName,
        I: idx,
      }),
    );
  }
}

function convertError(err: unknown) {
  if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
    throw new Error('duplicate');
  }
  throw err;
}

const toDB = (o: Map<string, unknown>) => JSON.stringify(Object.fromEntries(o.entries()));

// SQLite only cares about \ and " in quoted JSON path components, so escape those
// See https://github.com/sqlite/sqlite/blob/242a9347f879cd7da8c58e21bf4f8f2cb346366c/src/json.c#L2974
const toJSONPath = (key: string) => `$."${key.replaceAll(/["\\]/g, '\\$&')}"`;

function fromDB<T extends object, F extends readonly (string & keyof T)[]>(
  [id, data]: [string, string],
  fields?: F,
): Pick<T, F[number]> {
  return partialDeserialiseRecord<T, F>(
    new Map(Object.entries(JSON.parse(data))).set('id', id) as Serialised<T>,
    fields,
  );
}
