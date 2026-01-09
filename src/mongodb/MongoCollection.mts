import {
  type Collection as MCollection,
  Binary as MBinary,
  MongoError,
  type IndexDescriptionInfo,
} from 'mongodb';
import {
  type IDable,
  BaseCollection,
  type KeyOptions,
  type DBKeys,
  makeKeyValue,
  mapEntries,
  safeSet,
  safeGet,
  retry,
  type CollectionOptions,
} from '../core/index.mts';

const MONGO_ID = '_id';
const ID = 'id';

const DOT_REG = /\./g;
function attrToMongo(name: string): string {
  if (name === ID) {
    return MONGO_ID;
  }
  if (name === '__proto__') {
    // mongodb library itself cannot handle __proto__, so we encode the first underscore
    return '%5F_proto__';
  }
  return encodeURIComponent(name).replace(DOT_REG, '%2E');
}

function attributeFromMongo(name: string): string {
  if (name === MONGO_ID) {
    return ID;
  }
  return decodeURIComponent(name);
}

function valueToMongo(v: unknown): unknown {
  if (v instanceof Buffer) {
    return new MBinary(v);
  }
  if (v instanceof MBinary) {
    throw new Error('Must use Buffer to provide binary data');
  }
  return v;
}

function valueFromMongo(v: unknown): unknown {
  if (v instanceof MBinary) {
    return v.buffer;
  }
  return v;
}

const MONGO_ERROR_IDX = /^.*? index: ([^ ]+) dup key:.*$/;
function getErrorIndex(e: MongoError): string {
  return MONGO_ERROR_IDX.exec(e.message)?.[1] || '';
}

const withUpsertRetry = retry(
  (e) => e instanceof MongoError && e.code === 11000 && getErrorIndex(e) === '_id_',
);

function convertToMongo<T extends Partial<IDable>>(value: T): Record<string, unknown> {
  return mapEntries(value, valueToMongo, attrToMongo);
}

function convertFromMongo<T extends Partial<IDable>>(
  value: Record<string, unknown> | null,
): T | null {
  if (!value) {
    return null;
  }
  return mapEntries(value, valueFromMongo, attributeFromMongo) as T;
}

function makeMongoSearch(attribute: string | undefined, value: unknown): Record<string, unknown> {
  if (!attribute) {
    return {};
  }
  return makeKeyValue(attrToMongo(attribute), { $eq: valueToMongo(value) });
}

function makeMongoProjection(attributes?: readonly string[]): Record<string, number> {
  const projection: Record<string, number> = {};
  if (attributes) {
    projection[MONGO_ID] = 0;
    attributes.forEach((attr) => safeSet(projection, attrToMongo(attr), 1));
  }
  return projection;
}

function makeIndex(attribute: string, options: KeyOptions = {}): IndexDescriptionInfo {
  const unique = Boolean(options.unique);
  return {
    key: makeKeyValue(attrToMongo(attribute), unique ? 1 : ('hashed' as const)),
    unique,
  };
}

function indicesMatch(a: IndexDescriptionInfo, b: IndexDescriptionInfo): boolean {
  if (Boolean(a.unique) !== Boolean(b.unique)) {
    return false;
  }
  const keys = Object.entries(a.key);
  if (Object.keys(b.key).length !== keys.length) {
    return false;
  }
  return keys.every(([k, aVal]) => aVal === safeGet(b.key, k));
}

async function configureCollection(collection: MCollection, keys: DBKeys<any> = {}): Promise<void> {
  const existing = await collection.indexes().catch(() => []);
  const idxToCreate: IndexDescriptionInfo[] = [];
  const idxToDelete = new Set(existing.map((idx) => idx.name!));
  idxToDelete.delete('_id_'); // MongoDB implicit primary key

  for (const [keyName, options] of Object.entries(keys)) {
    const index = makeIndex(keyName, options);
    const match = existing.find((idx) => indicesMatch(idx, index));
    if (match) {
      idxToDelete.delete(match.name!);
    } else {
      idxToCreate.push(index);
    }
  }
  if (idxToCreate.length) {
    await collection.createIndexes(idxToCreate);
  }
  if (idxToDelete.size) {
    await Promise.all([...idxToDelete].map((idxName) => collection.dropIndex(idxName)));
  }
}

export class MongoCollection<T extends IDable> extends BaseCollection<T> {
  /** @internal */ private readonly _collection: MCollection;

  /** @internal */ constructor(options: CollectionOptions<T>, collection: MCollection) {
    super(options);
    this._collection = collection;
    this.initAsync(configureCollection(collection, options.keys));
  }

  protected override async internalAddBatch(records: T[]): Promise<void> {
    await this._collection.insertMany(records.map(convertToMongo));
  }

  /** @internal */ protected override async internalUpsert(
    id: T['id'],
    delta: Partial<T>,
  ): Promise<void> {
    await withUpsertRetry.promise(() =>
      this._collection.updateOne(
        makeMongoSearch('id', id),
        { $set: convertToMongo(delta) },
        { upsert: true },
      ),
    );
  }

  protected override async internalUpdate<K extends string & keyof T>(
    filterAttribute: K,
    filterValue: T[K],
    delta: Partial<T>,
  ): Promise<void> {
    const query = makeMongoSearch(filterAttribute, filterValue);
    const mongoDelta = { $set: convertToMongo(delta) };
    try {
      if (this.indices.isUniqueIndex(filterAttribute)) {
        await this._collection.updateOne(query, mongoDelta);
      } else {
        await this._collection.updateMany(query, mongoDelta);
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes("would modify the immutable field '_id'")) {
        throw new Error('Cannot update ID');
      } else {
        throw e;
      }
    }
  }

  /** @internal */ protected override async internalGet<
    K extends string & keyof T,
    F extends readonly (string & keyof T)[],
  >(
    filterAttribute: K | undefined,
    filterValue: T[K] | undefined,
    returnAttributes?: F,
  ): Promise<Readonly<Pick<T, F[number]>> | null> {
    const raw = await this._collection.findOne(makeMongoSearch(filterAttribute, filterValue), {
      projection: makeMongoProjection(returnAttributes),
    });
    return convertFromMongo<T>(raw);
  }

  protected override async *internalGetAll<
    K extends string & keyof T,
    F extends readonly (string & keyof T)[],
  >(filterAttribute?: K, filterValue?: T[K], returnAttributes?: F) {
    const cursor = this._collection.find(makeMongoSearch(filterAttribute, filterValue), {
      projection: makeMongoProjection(returnAttributes),
    });

    try {
      for await (const raw of cursor) {
        yield convertFromMongo<T>(raw)!;
      }
    } finally {
      await cursor.close();
    }
  }

  protected override async internalRemove<K extends string & keyof T>(
    filterAttribute: K | undefined,
    filterValue: T[K] | undefined,
  ): Promise<number> {
    const result = await this._collection.deleteMany(makeMongoSearch(filterAttribute, filterValue));
    return result.deletedCount || 0;
  }

  protected override async internalDestroy() {
    await this._collection.drop();
  }
}
