import { Redis } from 'ioredis';
import IDable from '../interfaces/IDable';
import Collection from '../interfaces/Collection';
import { DBKeys } from '../interfaces/DB';
import { serialiseValue, deserialiseValue } from '../helpers/serialiser';

interface KeyInfo {
  prefix: string;
  unique: boolean;
}

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

export default class RedisCollection<T extends IDable> implements Collection<T> {
  private readonly keys: { [K in keyof T]?: KeyInfo } = {};

  public constructor(
    private readonly client: Redis,
    private readonly prefix: string,
    keys: DBKeys<T> = {},
  ) {
    Object.keys(keys).forEach((k) => {
      const key = k as keyof DBKeys<T>;
      this.keys[key] = {
        prefix: `${prefix}-${key}`,
        unique: Boolean(keys[key]!.unique),
      };
    });
  }

  public async add(value: T): Promise<void> {
    const serialised = serialiseRecord(value);
    await this.internalCheckDuplicates(serialised, true);
    await this.setByKey(serialised.id, serialised);
    await this.internalPopulateIndices(serialised);
  }

  public async update<K extends keyof T & string>(
    keyName: K,
    key: T[K],
    value: Partial<T>,
    { upsert = false } = {},
  ): Promise<void> {
    const sId = (await this.internalGetSerialisedIds(keyName, key))[0];
    if (sId === undefined) {
      if (upsert) {
        await this.add(Object.assign({ [keyName]: key }, value as T));
      }
      return;
    }
    const oldSerialised = await this.getByKey(sId);
    const oldValue = deserialiseRecord(oldSerialised) as T;
    const newValue = Object.assign({}, oldValue, value);
    if (newValue.id !== oldValue.id) {
      throw new Error('Cannot update id');
    }
    const newSerialised = serialiseRecord(newValue);
    await this.internalRemoveIndices(oldSerialised);
    try {
      await this.internalCheckDuplicates(newSerialised, false);
    } catch (e) {
      await this.internalPopulateIndices(oldSerialised);
      throw e;
    }
    this.setByKey(newSerialised.id, newSerialised);
    await this.internalPopulateIndices(newSerialised);
  }

  public async get<
    K extends keyof T & string,
    F extends readonly (keyof T & string)[]
  >(
    keyName: K,
    key: T[K],
    fields?: F,
  ): Promise<Readonly<Pick<T, F[-1]>> | null> {
    const sId = (await this.internalGetSerialisedIds(keyName, key))[0];
    if (sId === undefined) {
      return null;
    }
    const value = await this.maybeGetByKey(sId, fields);
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
      sIds = await this.internalGetSerialisedIds(keyName, key!);
    } else {
      sIds = await this.client.keys(this.makeKey('*'));
      const cut = this.prefix.length + 1;
      sIds = sIds.map((v) => v.substr(cut));
    }
    return Promise.all(sIds.map(async (sId) => deserialiseRecord(
      await this.getByKey(sId, fields),
    ) as T));
  }

  public async remove<K extends keyof T & string>(
    key: K,
    value: T[K],
  ): Promise<number> {
    const sIds = await this.internalGetSerialisedIds(key, value);
    if (sIds.length === 0) {
      return 0;
    }
    await Promise.all(sIds.map(async (sId) => {
      const oldSerialised = await this.getByKey(sId);
      await this.internalRemoveIndices(oldSerialised);
    }));
    return this.client.del(...sIds.map(this.makeKey));
  }

  private makeKey = (
    serialisedId: string,
  ): string => `${this.prefix}:${serialisedId}`;

  private async setByKey(
    serialisedKey: string,
    serialised: Record<string, string>,
  ): Promise<void> {
    const keyValues: any[] = [];
    Object.entries(serialised).forEach(([k, v]) => {
      keyValues.push(k);
      keyValues.push(v);
    });
    await this.client.hmset(this.makeKey(serialisedKey), ...keyValues);
  }

  private async getByKey<F extends readonly (keyof T & string)[]>(
    serialisedKey: string,
    fields?: F,
  ): Promise<Record<string, string>> {
    const rkey = this.makeKey(serialisedKey);
    if (!fields) {
      return this.client.hgetall(rkey);
    }
    const result: any = {};
    const values = await this.client.hmget(rkey, ...fields);
    for (let i = 0; i < fields.length; i += 1) {
      result[fields[i]] = values[i];
    }
    return result;
  }

  private async maybeGetByKey<F extends readonly (keyof T & string)[]>(
    serialisedKey: string,
    fields?: F,
  ): Promise<Record<string, string> | null> {
    const result = await this.getByKey(serialisedKey, fields);
    const any = Object.values(result).some((v) => (v !== null));
    return any ? result : null;
  }

  private async internalGetSerialisedIds<K extends keyof T>(
    keyName: K,
    key: T[K],
  ): Promise<string[]> {
    const sKey = serialiseValue(key);
    if (keyName === 'id') {
      return (await this.client.exists(this.makeKey(sKey))) > 0 ? [sKey] : [];
    }
    const keyInfo = this.keys[keyName];
    if (!keyInfo) {
      throw new Error(`Requested key ${keyName} not indexed`);
    }
    if (!keyInfo.unique) {
      return this.client.smembers(`${keyInfo.prefix}:${sKey}`);
    }
    const sId = await this.client.get(`${keyInfo.prefix}:${sKey}`);
    return (sId === null) ? [] : [sId];
  }

  private async internalCheckDuplicates(
    serialisedValue: Record<string, string>,
    checkId: boolean,
  ): Promise<void> {
    if (checkId && await this.client.exists(this.makeKey(serialisedValue.id))) {
      throw new Error('duplicate');
    }
    await Promise.all(Object.entries(this.keys).map(async ([key, keyInfo]) => {
      const { prefix, unique } = keyInfo!;
      if (unique && await this.client.exists(`${prefix}:${serialisedValue[key]}`)) {
        throw new Error('duplicate');
      }
    }));
  }

  private async internalPopulateIndices(
    serialisedValue: Record<string, string>,
  ): Promise<void> {
    await Promise.all(Object.entries(this.keys).map(async ([key, keyInfo]) => {
      const { prefix, unique } = keyInfo!;
      const v = serialisedValue[key];
      if (unique) {
        await this.client.set(`${prefix}:${v}`, serialisedValue.id);
      } else {
        await this.client.sadd(`${prefix}:${v}`, serialisedValue.id);
      }
    }));
  }

  private async internalRemoveIndices(
    serialisedValue: Record<string, string>,
  ): Promise<void> {
    await Promise.all(Object.entries(this.keys).map(async ([key, keyInfo]) => {
      const { prefix, unique } = keyInfo!;
      const v = serialisedValue[key];
      if (unique) {
        await this.client.del(`${prefix}:${v}`);
      } else {
        await this.client.srem(`${prefix}:${v}`, serialisedValue.id);
      }
    }));
  }
}
