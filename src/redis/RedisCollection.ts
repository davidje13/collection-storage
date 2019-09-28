import { Redis } from 'ioredis';
import IDable from '../interfaces/IDable';
import Collection from '../interfaces/Collection';
import { DBKeys } from '../interfaces/DB';
import { serialiseValue, deserialiseValue } from '../helpers/serialiser';

function serialiseRecord<T>(
  record: T,
): Record<string, string> {
  const result: Record<string, string> = {};
  Object.keys(record).forEach((k) => {
    result[k] = serialiseValue((record as any)[k]);
  });
  return result;
}

function deserialiseRecord(
  record: Record<string, string>,
): Record<string, unknown> {
  const result: Record<string, any> = {};
  Object.keys(record).forEach((k) => {
    result[k] = deserialiseValue(record[k]);
  });
  return result;
}

interface Key {
  key: string;
  prefix: string;
}

export default class RedisCollection<T extends IDable> implements Collection<T> {
  private readonly keyPrefixes: { [K in keyof T]?: string } = {};

  private readonly keys: Key[] = [];

  private readonly uniqueKeys: Key[] = [];

  public constructor(
    private readonly client: Redis,
    private readonly prefix: string,
    keys: DBKeys<T> = {},
  ) {
    Object.keys(keys).forEach((k) => {
      const key = k as keyof DBKeys<T>;
      const keyPrefix = `${prefix}-${key}`;
      this.keyPrefixes[key] = keyPrefix;
      const keyInfo = { key, prefix: keyPrefix };
      this.keys.push(keyInfo);
      if (keys[key]!.unique) {
        this.uniqueKeys.push(keyInfo);
      }
    });
  }

  public async add(value: T): Promise<void> {
    const serialised = serialiseRecord(value);
    if (await this.client.exists(this.makeKey(serialised.id))) {
      throw new Error('duplicate');
    }
    await this.internalCheckKeyDuplicates(serialised.id, serialised);
    await this.runMulti([
      this.setByKey(serialised.id, serialised),
      ...this.internalMigrateIndices(serialised.id, {}, serialised),
    ]);
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

    const patchSerialised = serialiseRecord(value);
    const sId = (await this.internalGetPossibleSerialisedIds(keyName, key))[0];
    if (sId && patchSerialised.id && patchSerialised.id !== sId) {
      throw new Error('Cannot update id');
    }
    const oldSerialised = await this.readByKey(sId, Object.keys(value) as any[]);
    if (!oldSerialised) {
      if (upsert) {
        await this.add(Object.assign({ [keyName]: key }, value as T));
      }
      return;
    }
    await this.internalCheckKeyDuplicates(sId, patchSerialised);
    await this.runMulti([
      this.setByKey(sId, patchSerialised),
      ...this.internalMigrateIndices(sId, oldSerialised, patchSerialised),
    ]);
  }

  public async get<
    K extends keyof T & string,
    F extends readonly (keyof T & string)[]
  >(
    keyName: K,
    key: T[K],
    fields?: F,
  ): Promise<Readonly<Pick<T, F[-1]>> | null> {
    const sId = (await this.internalGetPossibleSerialisedIds(keyName, key))[0];
    const value = await this.readByKey(sId, fields);
    if (!value) {
      return null;
    }
    return deserialiseRecord(value) as T;
  }

  public async getAll<
    K extends keyof T & string,
    F extends readonly (keyof T & string)[]
  >(
    keyName?: K,
    key?: T[K],
    fields?: F,
  ): Promise<Readonly<Pick<T, F[-1]>>[]> {
    let sIds: string[];
    if (keyName) {
      sIds = await this.internalGetPossibleSerialisedIds(keyName, key!);
    } else {
      sIds = await this.client.keys(this.makeKey('*'));
      const cut = this.prefix.length + 1;
      sIds = sIds.map((v) => v.substr(cut));
    }
    const items = await this.readByKeys(sIds, fields);
    return items.map(deserialiseRecord) as T[];
  }

  public async remove<K extends keyof T & string>(
    key: K,
    value: T[K],
  ): Promise<number> {
    const indexedKeys = Object.keys(this.keyPrefixes) as any[];
    indexedKeys.push('id');

    const sIds = await this.internalGetPossibleSerialisedIds(key, value);
    const items = await this.readByKeys(sIds, indexedKeys);
    if (items.length === 0) {
      return 0;
    }

    await this.runMulti([
      ['del', ...items.map((item) => this.makeKey(item.id))],
      ...items.flatMap((item) => this.internalMigrateIndices(item.id, item, {})),
    ]);
    return items.length;
  }

  private makeKey(serialisedId: string): string {
    return `${this.prefix}:${serialisedId}`;
  }

  private setByKey(
    serialisedId: string,
    serialised: Record<string, string>,
  ): string[] {
    return [
      'hmset',
      this.makeKey(serialisedId),
      ...Object.entries(serialised).flat(),
    ];
  }

  private getByKey<F extends readonly (keyof T & string)[]>(
    serialisedId: string,
    fields?: F,
  ): string[] {
    const key = this.makeKey(serialisedId);
    if (!fields) {
      return ['hgetall', key];
    }
    return ['hmget', key, ...fields];
  }

  private async readByKey<F extends readonly (keyof T & string)[]>(
    serialisedId?: string,
    fields?: F,
  ): Promise<Record<string, string> | undefined> {
    if (serialisedId === undefined) {
      return undefined;
    }
    const items = await this.readByKeys([serialisedId], fields);
    return items[0];
  }

  private async readByKeys<F extends readonly (keyof T & string)[]>(
    serialisedIds: string[],
    fields?: F,
  ): Promise<Record<string, string>[]> {
    const results = await this.runMulti(serialisedIds.map((sId) => this.getByKey(sId, fields)));
    let items;
    if (fields) {
      items = results.map(([, item]) => {
        const result: any = {};
        for (let f = 0; f < fields.length; f += 1) {
          result[fields[f]] = item[f];
        }
        return result;
      });
    } else {
      items = results.map(([, item]) => item);
    }
    return items.filter((item) => Object.values(item).some((v) => (v !== null)));
  }

  private async internalGetPossibleSerialisedIds<K extends keyof T>(
    keyName: K,
    key: T[K],
  ): Promise<string[]> {
    const sKey = serialiseValue(key);
    if (keyName === 'id') {
      return [sKey];
    }
    const keyPrefix = this.keyPrefixes[keyName];
    if (!keyPrefix) {
      throw new Error(`Requested key ${keyName} not indexed`);
    }
    return this.client.smembers(`${keyPrefix}:${sKey}`);
  }

  private async internalCheckKeyDuplicates(
    serialisedId: string,
    partialSerialisedValue: Record<string, string>,
  ): Promise<void> {
    const records = await this.runMulti(
      this.uniqueKeys
        .filter(({ key }) => partialSerialisedValue[key])
        .map(({ key, prefix }) => (['smembers', `${prefix}:${partialSerialisedValue[key]}`])),
    );
    if (records.some(([, r]) => (r.length > 0 && r[0] !== serialisedId))) {
      throw new Error('duplicate');
    }
  }

  private internalMigrateIndices(
    serialisedId: string,
    partialOldSerialisedValue: Record<string, string>,
    partialNewSerialisedValue: Record<string, string>,
  ): (string[] | null)[] {
    return this.keys.map(({ key, prefix }) => {
      if (!partialNewSerialisedValue[key]) {
        if (!partialOldSerialisedValue[key]) {
          return null;
        }
        return [
          'srem',
          `${prefix}:${partialOldSerialisedValue[key]}`,
          serialisedId,
        ];
      }
      if (!partialOldSerialisedValue[key]) {
        return [
          'sadd',
          `${prefix}:${partialNewSerialisedValue[key]}`,
          serialisedId,
        ];
      }
      return [
        'smove',
        `${prefix}:${partialOldSerialisedValue[key]}`,
        `${prefix}:${partialNewSerialisedValue[key]}`,
        serialisedId,
      ];
    });
  }

  // returned values are [error, result] for each command
  private async runMulti(commands: (string[] | null)[]): Promise<[unknown, any][]> {
    const filtered = commands.filter(<T>(c: T | null): c is T => (c !== null));
    if (!filtered.length) {
      return [];
    }
    return this.client.multi(filtered).exec();
  }
}
