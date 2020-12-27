import {
  Collection as MCollection,
  Binary as MBinary,
  IndexSpecification,
  MongoError,
} from 'mongodb';
import type { IDable } from '../interfaces/IDable';
import BaseCollection from '../interfaces/BaseCollection';
import type { KeyOptions } from '../interfaces/Collection';
import type { DBKeys } from '../interfaces/DB';
import type { StateRef } from '../interfaces/BaseDB';
import { makeKeyValue, mapEntries, safeAdd, safeGet } from '../helpers/safeAccess';
import retry from '../helpers/retry';

const MONGO_ID = '_id';
const ID = 'id';

const DOT_REG = /\./g;
function fieldNameToMongo(name: string): string {
  if (name === ID) {
    return MONGO_ID;
  }
  if (name === '__proto__') {
    // mongodb library itself cannot handle __proto__, so we encode the first underscore
    return '%5F_proto__';
  }
  return encodeURIComponent(name).replace(DOT_REG, '%2E');
}

function fieldNameFromMongo(name: string): string {
  if (name === MONGO_ID) {
    return ID;
  }
  return decodeURIComponent(name);
}

function isBson(v: unknown): v is MBinary {
  return (
    Boolean(v) &&
    typeof v === 'object' &&
    /* eslint-disable-next-line no-underscore-dangle */
    Boolean((v as any)._bsontype)
  );
}

function valueToMongo(v: unknown): unknown {
  if (v instanceof Buffer) {
    return new MBinary(v);
  }
  if (isBson(v)) {
    throw new Error('Must use Buffer to provide binary data');
  }
  return v;
}

function valueFromMongo(v: unknown): unknown {
  if (isBson(v)) {
    return v.buffer;
  }
  return v;
}

const MONGO_ERROR_IDX = /^.*? index: ([^ ]+) dup key:.*$/;
function getErrorIndex(e: MongoError): string {
  return MONGO_ERROR_IDX.exec(e.message)?.[1] || '';
}

const withUpsertRetry = retry((e) => (
  e instanceof MongoError &&
  e.code === 11000 &&
  getErrorIndex(e) === '_id_'
));

function convertToMongo<T extends Partial<IDable>>(
  value: T,
): Record<string, unknown> {
  return mapEntries(value, valueToMongo, fieldNameToMongo);
}

function convertFromMongo<T extends Partial<IDable>>(
  value: Record<string, unknown> | null,
): T | null {
  if (!value) {
    return null;
  }
  return mapEntries(value, valueFromMongo, fieldNameFromMongo) as T;
}

function makeMongoSearch(key: string, value: unknown): Record<string, unknown> {
  return makeKeyValue(fieldNameToMongo(key), { $eq: valueToMongo(value) });
}

function makeMongoProjection(
  names?: readonly string[],
): Record<string, number> {
  const projection: Record<string, number> = {};
  if (names) {
    projection[MONGO_ID] = 0;
    names.forEach((fieldName) => safeAdd(projection, fieldNameToMongo(fieldName), 1));
  }
  return projection;
}

interface MongoIndex {
  name: string;
  key: Record<string, -1 | 0 | 1 | 'hashed'>;
  unique?: boolean;
}

function makeIndex(keyName: string, options: KeyOptions = {}): IndexSpecification {
  const unique = Boolean(options.unique);
  return {
    key: makeKeyValue(fieldNameToMongo(keyName), unique ? 1 : 'hashed'),
    unique,
  };
}

function indicesMatch(a: IndexSpecification, b: IndexSpecification): boolean {
  if (Boolean(a.unique) !== Boolean(b.unique)) {
    return false;
  }
  const keys = Object.entries(a.key);
  if (Object.keys(b.key).length !== keys.length) {
    return false;
  }
  return keys.every(([k, aVal]) => (aVal === safeGet(b.key, k)));
}

async function configureCollection(
  collection: MCollection,
  keys: DBKeys<any> = {},
): Promise<void> {
  const existing: MongoIndex[] = await collection.indexes().catch(() => []);
  const idxToCreate: IndexSpecification[] = [];
  const idxToDelete = new Set(existing.map((idx) => idx.name));
  idxToDelete.delete('_id_'); // MongoDB implicit primary key

  Object.entries(keys)
    .map(([keyName, options]) => makeIndex(keyName, options))
    .forEach((index) => {
      const match = existing.find((idx) => indicesMatch(idx, index));
      if (match) {
        idxToDelete.delete(match.name);
      } else {
        idxToCreate.push(index);
      }
    });
  if (idxToCreate.length) {
    await collection.createIndexes(idxToCreate);
  }
  if (idxToDelete.size) {
    await Promise.all([...idxToDelete].map((idxName) => collection.dropIndex(idxName)));
  }
}

export default class MongoCollection<T extends IDable> extends BaseCollection<T> {
  public constructor(
    private readonly collection: MCollection,
    keys: DBKeys<T> = {},
    private readonly stateRef: StateRef = { closed: false },
  ) {
    super(keys);
    this.initAsync(configureCollection(collection, keys));
  }

  protected preAct(): void {
    if (this.stateRef.closed) {
      throw new Error('Connection closed');
    }
  }

  protected async internalAdd(value: T): Promise<void> {
    await this.collection.insertOne(convertToMongo(value));
  }

  protected async internalUpsert(
    id: T['id'],
    update: Partial<T>,
  ): Promise<void> {
    await withUpsertRetry(() => this.collection.updateOne(
      makeMongoSearch('id', id),
      { $set: convertToMongo(update) },
      { upsert: true },
    ));
  }

  protected async internalUpdate<K extends string & keyof T>(
    searchAttribute: K,
    searchValue: T[K],
    update: Partial<T>,
  ): Promise<void> {
    const query = makeMongoSearch(searchAttribute, searchValue);
    const mongoUpdate = { $set: convertToMongo(update) };
    try {
      if (this.indices.isUniqueIndex(searchAttribute)) {
        await this.collection.updateOne(query, mongoUpdate);
      } else {
        await this.collection.updateMany(query, mongoUpdate);
      }
    } catch (e) {
      if (e.message.includes('would modify the immutable field \'_id\'')) {
        throw new Error('Cannot update ID');
      } else {
        throw e;
      }
    }
  }

  protected async internalGet<
    K extends string & keyof T,
    F extends readonly (string & keyof T)[]
  >(
    searchAttribute: K,
    searchValue: T[K],
    returnAttributes?: F,
  ): Promise<Readonly<Pick<T, F[-1]>> | null> {
    const raw = await this.collection.findOne(
      makeMongoSearch(searchAttribute, searchValue),
      { projection: makeMongoProjection(returnAttributes) },
    );
    return convertFromMongo<T>(raw);
  }

  protected async internalGetAll<
    K extends string & keyof T,
    F extends readonly (string & keyof T)[]
  >(
    searchAttribute?: K,
    searchValue?: T[K],
    returnAttributes?: F,
  ): Promise<Readonly<Pick<T, F[-1]>>[]> {
    const cursor = this.collection.find(
      searchAttribute ? makeMongoSearch(searchAttribute, searchValue) : {},
      { projection: makeMongoProjection(returnAttributes) },
    );

    const result: Pick<T, F[-1]>[] = [];
    await cursor.forEach((raw) => result.push(convertFromMongo<T>(raw)!));

    return result;
  }

  protected async internalRemove<K extends string & keyof T>(
    searchAttribute: K,
    searchValue: T[K],
  ): Promise<number> {
    const result = await this.collection.deleteMany(
      makeMongoSearch(searchAttribute, searchValue),
    );
    return result.deletedCount || 0;
  }
}
