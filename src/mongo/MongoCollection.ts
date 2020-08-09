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
import retry from '../helpers/retry';

const MONGO_ID = '_id';
const ID = 'id';

const DOT_REG = /\./g;
function fieldNameToMongo(name: string): string {
  if (name === ID) {
    return MONGO_ID;
  }
  return encodeURIComponent(name).replace(DOT_REG, '%2E');
}

function fieldNameFromMongo(name: string): string {
  if (name === MONGO_ID) {
    return ID;
  }
  return decodeURIComponent(name);
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
  const converted: Record<string, unknown> = {};
  Object.keys(value).forEach((k) => {
    let v = (value as any)[k];
    if (v instanceof Buffer) {
      v = new MBinary(v);
      // eslint-disable-next-line no-underscore-dangle
    } else if (typeof v === 'object' && v._bsontype) {
      throw new Error('Must use Buffer to provide binary data');
    }
    converted[fieldNameToMongo(k)] = v;
  });
  return converted;
}

function convertFromMongo<T extends Partial<IDable>>(
  value: Record<string, unknown> | null,
): T | null {
  if (!value) {
    return null;
  }
  const converted: T = {} as any;
  Object.keys(value).forEach((k) => {
    let v = (value as any)[k];
    // eslint-disable-next-line no-underscore-dangle
    if (typeof v === 'object' && v._bsontype === 'Binary') {
      v = v.buffer;
    }
    (converted as any)[fieldNameFromMongo(k)] = v;
  });
  return converted;
}

function makeMongoProjection(
  names?: readonly string[],
): Record<string, boolean> {
  const projection: Record<string, boolean> = {};
  if (names) {
    projection[MONGO_ID] = false;
    names.forEach((fieldName) => {
      projection[fieldNameToMongo(fieldName)] = true;
    });
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
  const mongoKey = fieldNameToMongo(keyName);
  return {
    key: { [mongoKey]: unique ? 1 : 'hashed' },
    unique,
  };
}

function indicesMatch(a: IndexSpecification, b: IndexSpecification): boolean {
  if (Boolean(a.unique) !== Boolean(b.unique)) {
    return false;
  }
  const aKey = a.key as Record<string, unknown>;
  const bKey = b.key as Record<string, unknown>;
  const keys = Object.keys(aKey);
  if (Object.keys(bKey).length !== keys.length) {
    return false;
  }
  return keys.every((k) => (aKey[k] === bKey[k]));
}

async function configureCollection(
  collection: MCollection,
  keys: DBKeys<any> = {},
): Promise<void> {
  const existing: MongoIndex[] = await collection.indexes().catch(() => []);
  const idxToCreate: IndexSpecification[] = [];
  const idxToDelete = new Set(existing.map((idx) => idx.name));
  idxToDelete.delete('_id_'); // MongoDB implicit primary key

  Object.keys(keys)
    .map((keyName) => makeIndex(keyName, keys[keyName]))
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
      convertToMongo({ id }),
      { $set: convertToMongo(update) },
      { upsert: true },
    ));
  }

  protected async internalUpdate<K extends keyof T & string>(
    searchAttribute: K,
    searchValue: T[K],
    update: Partial<T>,
  ): Promise<void> {
    const query = convertToMongo({ [searchAttribute]: searchValue });
    const mongoUpdate = { $set: convertToMongo(update) };
    if (this.isIndexUnique(searchAttribute)) {
      await this.collection.updateOne(query, mongoUpdate);
    } else {
      await this.collection.updateMany(query, mongoUpdate);
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
    const raw = await this.collection.findOne(
      convertToMongo({ [searchAttribute]: searchValue }),
      { projection: makeMongoProjection(returnAttributes) },
    );
    return convertFromMongo<T>(raw);
  }

  protected async internalGetAll<
    K extends keyof T & string,
    F extends readonly (keyof T & string)[]
  >(
    searchAttribute?: K,
    searchValue?: T[K],
    returnAttributes?: F,
  ): Promise<Readonly<Pick<T, F[-1]>>[]> {
    const cursor = this.collection.find(
      searchAttribute ? convertToMongo({ [searchAttribute]: searchValue }) : {},
      { projection: makeMongoProjection(returnAttributes) },
    );

    const result: Pick<T, F[-1]>[] = [];
    await cursor.forEach((raw) => result.push(convertFromMongo<T>(raw)!));

    return result;
  }

  protected async internalRemove<K extends keyof T & string>(
    searchAttribute: K,
    searchValue: T[K],
  ): Promise<number> {
    const result = await this.collection.deleteMany(
      convertToMongo({ [searchAttribute]: searchValue }),
    );
    return result.deletedCount || 0;
  }
}
