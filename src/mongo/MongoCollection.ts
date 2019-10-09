import {
  Collection as MCollection,
  Cursor as MCursor,
  Binary as MBinary,
} from 'mongodb';
import IDable from '../interfaces/IDable';
import Collection from '../interfaces/Collection';
import { DBKeys } from '../interfaces/DB';
import retry from '../helpers/retry';

const MONGO_ID = '_id';
const ID = 'id';

interface State {
  closed: boolean;
}

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

const withUpsertRetry = retry((e) => (
  typeof e === 'object' &&
  e.message.includes('E11000')
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

function makeMongoFields(names?: readonly string[]): Record<string, boolean> {
  const fields: Record<string, boolean> = {};
  if (names) {
    fields[MONGO_ID] = false;
    names.forEach((fieldName) => {
      fields[fieldNameToMongo(fieldName)] = true;
    });
  }
  return fields;
}

export default class MongoCollection<T extends IDable> implements Collection<T> {
  public constructor(
    private readonly collection: MCollection,
    private readonly keys: DBKeys<T> = {},
    private readonly stateRef: State = { closed: false },
  ) {
    Object.keys(keys).forEach((k) => {
      const keyName = k as keyof DBKeys<T>;
      const options = keys[keyName];
      const mongoKey = fieldNameToMongo(keyName);
      if (options && options.unique) {
        collection.createIndex({ [mongoKey]: 1 }, { unique: true });
      } else {
        collection.createIndex({ [mongoKey]: 'hashed' });
      }
    });
  }

  public async add(value: T): Promise<void> {
    await this.getCollection().insertOne(convertToMongo(value));
  }

  public async update<K extends keyof T & string>(
    keyName: K,
    key: T[K],
    value: Partial<T>,
    { upsert = false } = {},
  ): Promise<void> {
    if (upsert && keyName !== 'id') {
      throw new Error(`Can only upsert by ID, not ${keyName}`);
    }

    this.checkIndexExists(keyName);

    if (upsert) {
      // special handling due to https://jira.mongodb.org/browse/SERVER-14322
      await withUpsertRetry(() => this.getCollection().updateOne(
        convertToMongo({ [keyName]: key }),
        { $set: convertToMongo(value) },
        { upsert: true },
      ));
    } else {
      await this.getCollection().updateOne(
        convertToMongo({ [keyName]: key }),
        { $set: convertToMongo(value) },
      );
    }
  }

  public async get<
    K extends keyof T & string,
    F extends readonly (keyof T & string)[]
  >(
    keyName: K,
    key: T[K],
    fields?: F,
  ): Promise<Readonly<Pick<T, F[-1]>> | null> {
    this.checkIndexExists(keyName);

    const raw = await this.getCollection().findOne(
      convertToMongo({ [keyName]: key }),
      { projection: makeMongoFields(fields) },
    );
    return convertFromMongo<T>(raw);
  }

  public async getAll<
    K extends keyof T & string,
    F extends readonly (keyof T & string)[]
  >(
    keyName?: K,
    key?: T[K],
    fields?: F,
  ): Promise<Readonly<Pick<T, F[-1]>>[]> {
    const result: Pick<T, F[-1]>[] = [];

    let cursor: MCursor;
    const mFields = makeMongoFields(fields);
    if (keyName) {
      this.checkIndexExists(keyName);

      cursor = this.getCollection().find(
        convertToMongo({ [keyName]: key }),
        { projection: mFields },
      );
    } else {
      cursor = this.getCollection().find({}, { projection: mFields });
    }
    await cursor.forEach((raw) => result.push(convertFromMongo<T>(raw)!));

    return result;
  }

  public async remove<K extends keyof T & string>(
    key: K,
    value: T[K],
  ): Promise<number> {
    this.checkIndexExists(key);

    const result = await this.getCollection().deleteMany(
      convertToMongo({ [key]: value }),
    );
    return result.deletedCount || 0;
  }

  private checkIndexExists(key: string): void {
    if (key !== 'id' && !(this.keys as any)[key]) {
      throw new Error(`No index for ${key}`);
    }
  }

  private getCollection(): MCollection {
    if (this.stateRef.closed) {
      throw new Error('Connection closed');
    }
    return this.collection;
  }
}
