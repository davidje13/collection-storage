import { Redis } from 'ioredis';
import IDable from '../interfaces/IDable';
import Collection from '../interfaces/Collection';
import { DBKeys } from '../interfaces/DB';
import {
  serialiseValue,
  serialiseRecord,
  deserialiseRecord,
} from '../helpers/serialiser';
import { multiExec, ExtendedRedis } from './helpers';
import defineAllScripts, { ScriptExtensions } from './scripts';

interface Key<T> {
  key: keyof T & string;
  prefix: string;
}

function makeIndexKeys(
  keys: Key<any>[],
  partialSerialisedValue: Record<string, string | null>,
): string[] {
  return keys
    .filter(({ key }) => partialSerialisedValue[key])
    .map(({ key, prefix }) => `${prefix}:${partialSerialisedValue[key]}`);
}

function parseItem(
  item: (string | null)[] | Record<string, string | null>,
  fields?: readonly string[],
): Record<string, string | null> {
  if (!fields) {
    return item as any;
  }
  const result: Record<string, string | null> = {};
  for (let f = 0; f < fields.length; f += 1) {
    result[fields[f]] = (item as any)[f];
  }
  return result;
}

function itemHasContent(item: Record<string, string | null>): boolean {
  return Object.values(item).some((v) => (v !== null));
}

export default class RedisCollection<T extends IDable> implements Collection<T> {
  private readonly client: ExtendedRedis<ScriptExtensions>;

  private readonly keyPrefixes: { [K in keyof T]?: string } = {};

  private readonly keys: Key<T>[] = [];

  private readonly uniqueKeys: Key<T>[] = [];

  private readonly nonUniqueKeys: Key<T>[] = [];

  public constructor(
    client: Redis,
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
      } else {
        this.nonUniqueKeys.push(keyInfo);
      }
    });

    this.client = defineAllScripts(client);
  }

  public async add(value: T): Promise<void> {
    const added = await this.internalAdd(serialiseRecord(value), false);
    if (!added) {
      throw new Error('duplicate');
    }
  }

  public async update<K extends keyof T & string>(
    keyName: K,
    key: T[K],
    value: Partial<T>,
    { upsert = false } = {},
  ): Promise<void> {
    const { id, ...patchSerialised } = serialiseRecord(value);
    const sKey = serialiseValue(key);
    if (upsert && keyName !== 'id' && !id) {
      throw new Error('Cannot upsert without ID');
    }

    try {
      const sId = (await this.getAndWatchBySerialisedKey(keyName, sKey))[0];
      if (sId) {
        if (id && id !== sId) {
          throw new Error('Cannot update id');
        }
      } else if (!upsert) {
        return;
      }
      const rKey = this.makeKey(sId || id);
      await this.client.watch(rKey);
      const oldSerialised = sId && await this.rawByKeyKeepWatches(
        sId,
        this.keys.map((k) => k.key).filter((k) => patchSerialised[k]),
      );
      if (!oldSerialised) {
        if (upsert) {
          await this.internalAdd(
            { id, [keyName]: sKey, ...patchSerialised },
            true,
          );
        }
        return;
      }
      Object.keys(patchSerialised).forEach((k) => {
        if (oldSerialised[k] === patchSerialised[k]) {
          delete patchSerialised[k];
          delete oldSerialised[k];
        }
      });
      const diff = Object.entries(patchSerialised).flat();
      if (!diff.length) {
        return; // nothing changed
      }
      const patchUniqueKeys = makeIndexKeys(this.uniqueKeys, patchSerialised);
      const patchNonUniqueKeys = makeIndexKeys(this.nonUniqueKeys, patchSerialised);
      const oldUniqueKeys = makeIndexKeys(this.uniqueKeys, oldSerialised);
      const oldNonUniqueKeys = makeIndexKeys(this.nonUniqueKeys, oldSerialised);
      if (
        oldUniqueKeys.length !== patchUniqueKeys.length ||
        oldNonUniqueKeys.length !== patchNonUniqueKeys.length
      ) {
        throw new Error('unexpected key mismatch with old value');
      }
      const keyCount = 1 + (patchUniqueKeys.length + patchNonUniqueKeys.length) * 2;
      const params = [
        rKey,
        ...patchUniqueKeys,
        ...patchNonUniqueKeys,
        ...oldUniqueKeys,
        ...oldNonUniqueKeys,
        patchUniqueKeys.length,
        patchUniqueKeys.length + patchNonUniqueKeys.length,
        sId,
        ...diff,
      ];
      const updated = await this.client
        .multi()
        .update(keyCount, params)
        .exec();
      if (!updated) {
        throw new Error('rollback');
      }
      if (!updated[0][1]) {
        throw new Error('duplicate');
      }
    } finally {
      await this.client.unwatch();
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
    const sKey = serialiseValue(key);
    try {
      const sId = (await this.getAndWatchBySerialisedKey(keyName, sKey))[0];
      if (sId === undefined) {
        return null;
      }
      const results = await this.getByKeysKeepWatches([sId], fields);
      return results[0] || null;
    } finally {
      await this.client.unwatch();
    }
  }

  public async getAll<
    K extends keyof T & string,
    F extends readonly (keyof T & string)[]
  >(
    keyName?: K,
    key?: T[K],
    fields?: F,
  ): Promise<Readonly<Pick<T, F[-1]>>[]> {
    try {
      let sIds: string[];
      if (keyName) {
        const sKey = serialiseValue(key);
        sIds = await this.getAndWatchBySerialisedKey(keyName, sKey);
      } else {
        sIds = await this.client.keys(this.makeKey('*'));
        const cut = this.prefix.length + 1;
        sIds = sIds.map((v) => v.substr(cut));
      }
      return await this.getByKeysKeepWatches(sIds, fields);
    } finally {
      await this.client.unwatch();
    }
  }

  public async remove<K extends keyof T & string>(
    key: K,
    value: T[K],
  ): Promise<number> {
    const sKey = serialiseValue(value);
    const indexedKeys = this.keys.map((k) => k.key);
    indexedKeys.push('id');

    try {
      const sIds = await this.getAndWatchBySerialisedKey(key, sKey);
      const items = (await Promise.all(
        sIds.map((sId) => this.rawByKeyKeepWatches(sId, indexedKeys)),
      )).filter(<T>(item?: T): item is T => (item !== undefined));

      if (items.length === 0) {
        return 0;
      }

      const pipeline = this.client.multi();
      items.forEach((item) => {
        const keys = makeIndexKeys(this.keys, item);
        pipeline.remove(
          1 + keys.length,
          this.makeKey(item.id!),
          ...keys,
          item.id!,
        );
      });
      await pipeline.exec();
      return items.length;
    } finally {
      await this.client.unwatch();
    }
  }

  private makeKey(serialisedId: string): string {
    return `${this.prefix}:${serialisedId}`;
  }

  private async internalAdd(
    { id, ...serialised }: Record<string, string>,
    checkWatch: boolean,
  ): Promise<boolean> {
    const uniqueKeys = makeIndexKeys(this.uniqueKeys, serialised);
    const nonUniqueKeys = makeIndexKeys(this.nonUniqueKeys, serialised);

    const keyCount = 1 + uniqueKeys.length + nonUniqueKeys.length;
    const params = [
      this.makeKey(id),
      ...uniqueKeys,
      ...nonUniqueKeys,
      uniqueKeys.length,
      'id', // ID is always first in flattened key/value pairs
      id,
      ...Object.entries(serialised).flat(),
    ];

    if (!checkWatch) {
      return Boolean(await this.client.add(keyCount, ...params));
    }

    const result = await this.client
      .multi()
      .add(keyCount, ...params)
      .exec();
    if (!result) {
      throw new Error('rollback');
    }
    return Boolean(result[0][1]);
  }

  private async getByKeysKeepWatches<F extends readonly (keyof T & string)[]>(
    serialisedIds: string[],
    fields?: F,
  ): Promise<Readonly<Pick<T, F[-1]>>[]> {
    const results = await multiExec(
      this.client,
      serialisedIds
        .map((sId) => this.makeKey(sId))
        .map((k) => (fields ? ['hmget', k, ...fields] : ['hgetall', k])),
    );
    if (!results) {
      throw new Error('rollback');
    }
    return results
      .map(([, item]: [unknown, any]) => parseItem(item, fields))
      .filter(itemHasContent)
      .map(deserialiseRecord) as T[];
  }

  private async rawByKeyKeepWatches(
    serialisedId: string,
    fields?: readonly (keyof T & string)[],
  ): Promise<Record<string, string | null> | undefined> {
    const key = this.makeKey(serialisedId);
    let item;
    if (fields) {
      if (!fields.length) {
        // just check existence
        const exists = await this.client.exists(key);
        return exists ? {} : undefined;
      }
      item = await this.client.hmget(key, ...fields);
    } else {
      item = await this.client.hgetall(key);
    }
    const parsed = parseItem(item, fields);
    return itemHasContent(parsed) ? parsed : undefined;
  }

  private async getAndWatchBySerialisedKey(
    keyName: keyof T,
    serialisedValue: string,
  ): Promise<string[]> {
    if (keyName === 'id') {
      return [serialisedValue];
    }
    const keyPrefix = this.keyPrefixes[keyName];
    if (!keyPrefix) {
      throw new Error(`Requested key ${keyName} not indexed`);
    }
    const keyAddress = `${keyPrefix}:${serialisedValue}`;
    await this.client.watch(keyAddress);
    return this.client.smembers(keyAddress);
  }
}
