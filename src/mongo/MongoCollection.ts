import { Collection as MCollection, Cursor as MCursor } from 'mongodb';
import IDable from '../interfaces/IDable';
import Collection from '../interfaces/Collection';
import { DBKeys } from '../interfaces/DB';

const MONGO_ID = '_id';
const ID = 'id';

type MongoT<T extends Partial<IDable>> = Omit<T, 'id'> & { _id?: T['id'] };

function fieldNameToMongo(name: string): string {
  if (name === ID) {
    return MONGO_ID;
  }
  return name;
}

function convertToMongo<T extends Partial<IDable>>(value: T): MongoT<T> {
  if (!value || value[ID] === undefined) {
    return value;
  }
  const { [ID]: id, ...rest } = value;
  return { [MONGO_ID]: id, ...rest };
}

function convertFromMongo<T extends Partial<IDable>>(
  value: MongoT<T> | null,
): T | null {
  if (!value || value[MONGO_ID] === undefined) {
    return value as T | null;
  }
  const { [MONGO_ID]: id, ...rest } = value;
  return { [ID]: id, ...rest } as any;
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
    await this.collection.insertOne(convertToMongo(value));
  }

  public async update<K extends keyof T & string>(
    keyName: K,
    key: T[K],
    value: Partial<T>,
    { upsert = false } = {},
  ): Promise<void> {
    await this.collection.updateOne(
      { [fieldNameToMongo(keyName)]: key },
      { $set: convertToMongo(value) },
      { upsert },
    );
  }

  public async get<
    K extends keyof T & string,
    F extends readonly (keyof T & string)[]
  >(
    keyName: K,
    key: T[K],
    fields?: F,
  ): Promise<Readonly<Pick<T, F[-1]>> | null> {
    const raw = await this.collection.findOne<T>(
      { [fieldNameToMongo(keyName)]: key },
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
      cursor = this.collection.find<T>(
        { [fieldNameToMongo(keyName)]: key },
        { projection: mFields },
      );
    } else {
      cursor = this.collection.find<T>({}, { projection: mFields });
    }
    await cursor.forEach((raw) => result.push(convertFromMongo<T>(raw)!));

    return result;
  }
}
