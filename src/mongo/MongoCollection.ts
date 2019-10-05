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

type MongoT<T extends Partial<IDable>> = Omit<T, 'id'> & { _id?: T['id'] };

interface State {
  closed: boolean;
}

function fieldNameToMongo(name: string): string {
  if (name === ID) {
    return MONGO_ID;
  }
  return name;
}

const withUpsertRetry = retry((e) => (
  typeof e === 'object' &&
  e.message.includes('E11000')
));

function convertToMongo<T extends Partial<IDable>>(value: T): MongoT<T> {
  let converted: MongoT<T>;
  // keys
  if (value[ID] === undefined) {
    converted = Object.assign({}, value);
  } else {
    const { [ID]: id, ...rest } = value;
    converted = { [MONGO_ID]: id, ...rest };
  }
  // values
  Object.keys(converted).forEach((k) => {
    const v = (converted as any)[k];
    if (v instanceof Buffer) {
      (converted as any)[k] = new MBinary(v);
    }
    // eslint-disable-next-line no-underscore-dangle
    if (typeof v === 'object' && v._bsontype) {
      throw new Error('Must use Buffer to provide binary data');
    }
  });
  return converted;
}

function convertFromMongo<T extends Partial<IDable>>(
  value: MongoT<T> | null,
): T | null {
  if (!value) {
    return null;
  }
  let converted: T;
  // keys
  if (value[MONGO_ID] === undefined) {
    converted = Object.assign({}, value) as T;
  } else {
    const { [MONGO_ID]: id, ...rest } = value;
    converted = { [ID]: id, ...rest } as any;
  }
  // values
  Object.keys(converted).forEach((k) => {
    const v = (converted as any)[k];
    // eslint-disable-next-line no-underscore-dangle
    if (typeof v === 'object' && v._bsontype === 'Binary') {
      (converted as any)[k] = v.buffer;
    }
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
    keys: DBKeys<T> = {},
    private readonly stateRef: State = { closed: false },
  ) {
    Object.keys(keys).forEach((k) => {
      const keyName = k as keyof DBKeys<T>;
      const options = keys[keyName];
      if (options && options.unique) {
        collection.createIndex({ [keyName]: 1 }, { unique: true });
      } else {
        collection.createIndex({ [keyName]: 'hashed' });
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
    if (upsert && keyName !== 'id' && value.id === undefined) {
      throw new Error('Cannot upsert without ID');
    }

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
    const raw = await this.getCollection().findOne<T>(
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

    let cursor: MCursor<T>;
    const mFields = makeMongoFields(fields);
    if (keyName) {
      cursor = this.getCollection().find<T>(
        convertToMongo({ [keyName]: key }),
        { projection: mFields },
      );
    } else {
      cursor = this.getCollection().find<T>({}, { projection: mFields });
    }
    await cursor.forEach((raw) => result.push(convertFromMongo<T>(raw)!));

    return result;
  }

  public async remove<K extends keyof T & string>(
    key: K,
    value: T[K],
  ): Promise<number> {
    const result = await this.getCollection().deleteMany(
      convertToMongo({ [key]: value }),
    );
    return result.deletedCount || 0;
  }

  private getCollection(): MCollection {
    if (this.stateRef.closed) {
      throw new Error('Connection closed');
    }
    return this.collection;
  }
}
