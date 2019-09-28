import IDable from '../interfaces/IDable';
import Collection from '../interfaces/Collection';
import { DBKeys } from '../interfaces/DB';
import {
  serialiseValue,
  serialiseRecord,
  deserialiseRecord,
} from '../helpers/serialiser';
import RedisConnectionPool from './RedisConnectionPool';
import { multiExec } from './helpers';
import { ERedis } from './scripts';

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

async function unwatchAll(client: ERedis): Promise<void> {
  await client.unwatch();
}

export default class RedisCollection<T extends IDable> implements Collection<T> {
  private readonly keyPrefixes: { [K in keyof T]?: string } = {};

  private readonly keys: Key<T>[] = [];

  private readonly uniqueKeys: Key<T>[] = [];

  private readonly nonUniqueKeys: Key<T>[] = [];

  public constructor(
    private readonly pool: RedisConnectionPool,
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
  }

  public add(value: T): Promise<void> {
    const serialised = serialiseRecord(value);
    return this.pool.withConnection(async (client) => {
      const added = await this.internalAdd(client, serialised, false);
      if (!added) {
        throw new Error('duplicate');
      }
    });
  }

  public update<K extends keyof T & string>(
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

    return this.pool.retryWithConnection(async (client) => {
      const sId = (await this.getAndWatchBySerialisedKey(client, keyName, sKey))[0];
      if (sId) {
        if (id && id !== sId) {
          throw new Error('Cannot update id');
        }
      } else if (!upsert) {
        return;
      }
      const rKey = this.makeKey(sId || id);
      await client.watch(rKey);
      const oldSerialised = sId && await this.rawByKeyKeepWatches(
        client,
        sId,
        this.keys.map((k) => k.key).filter((k) => patchSerialised[k]),
      );
      if (!oldSerialised) {
        if (upsert) {
          await this.internalAdd(
            client,
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
      const updated = await client
        .multi()
        .update(keyCount, params)
        .exec();
      if (!updated) {
        throw new Error('transient error');
      }
      if (!updated[0][1]) {
        throw new Error('duplicate');
      }
    }, unwatchAll);
  }

  public get<
    K extends keyof T & string,
    F extends readonly (keyof T & string)[]
  >(
    keyName: K,
    key: T[K],
    fields?: F,
  ): Promise<Readonly<Pick<T, F[-1]>> | null> {
    const sKey = serialiseValue(key);
    return this.pool.retryWithConnection(async (client) => {
      const sId = (await this.getAndWatchBySerialisedKey(client, keyName, sKey))[0];
      if (sId === undefined) {
        return null;
      }
      const results = await this.getByKeysKeepWatches(client, [sId], fields);
      return results[0] || null;
    }, unwatchAll);
  }

  public getAll<
    K extends keyof T & string,
    F extends readonly (keyof T & string)[]
  >(
    keyName?: K,
    key?: T[K],
    fields?: F,
  ): Promise<Readonly<Pick<T, F[-1]>>[]> {
    return this.pool.retryWithConnection(async (client) => {
      let sIds: string[];
      if (keyName) {
        const sKey = serialiseValue(key);
        sIds = await this.getAndWatchBySerialisedKey(client, keyName, sKey);
      } else {
        sIds = await client.keys(this.makeKey('*'));
        const cut = this.prefix.length + 1;
        sIds = sIds.map((v) => v.substr(cut));
      }
      return this.getByKeysKeepWatches(client, sIds, fields);
    }, unwatchAll);
  }

  public remove<K extends keyof T & string>(
    key: K,
    value: T[K],
  ): Promise<number> {
    const sKey = serialiseValue(value);
    const indexedKeys = this.keys.map((k) => k.key);
    indexedKeys.push('id');

    return this.pool.retryWithConnection(async (client) => {
      const sIds = await this.getAndWatchBySerialisedKey(client, key, sKey);
      const items = (await Promise.all(
        sIds.map((sId) => this.rawByKeyKeepWatches(client, sId, indexedKeys)),
      )).filter(<T>(item?: T): item is T => (item !== undefined));

      if (items.length === 0) {
        return 0;
      }

      const pipeline = client.multi();
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
    }, unwatchAll);
  }

  private makeKey(serialisedId: string): string {
    return `${this.prefix}:${serialisedId}`;
  }

  private async internalAdd(
    client: ERedis,
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
      return Boolean(await client.add(keyCount, ...params));
    }

    const result = await client
      .multi()
      .add(keyCount, ...params)
      .exec();
    if (!result) {
      throw new Error('transient error');
    }
    return Boolean(result[0][1]);
  }

  private async getByKeysKeepWatches<F extends readonly (keyof T & string)[]>(
    client: ERedis,
    serialisedIds: string[],
    fields?: F,
  ): Promise<Readonly<Pick<T, F[-1]>>[]> {
    const results = await multiExec(
      client,
      serialisedIds
        .map((sId) => this.makeKey(sId))
        .map((k) => (fields ? ['hmget', k, ...fields] : ['hgetall', k])),
    );
    if (!results) {
      throw new Error('transient error');
    }
    return results
      .map(([, item]: [unknown, any]) => parseItem(item, fields))
      .filter(itemHasContent)
      .map(deserialiseRecord) as T[];
  }

  private async rawByKeyKeepWatches(
    client: ERedis,
    serialisedId: string,
    fields?: readonly (keyof T & string)[],
  ): Promise<Record<string, string | null> | undefined> {
    const key = this.makeKey(serialisedId);
    let item;
    if (fields) {
      if (!fields.length) {
        // just check existence
        const exists = await client.exists(key);
        return exists ? {} : undefined;
      }
      item = await client.hmget(key, ...fields);
    } else {
      item = await client.hgetall(key);
    }
    const parsed = parseItem(item, fields);
    return itemHasContent(parsed) ? parsed : undefined;
  }

  private async getAndWatchBySerialisedKey(
    client: ERedis,
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
    await client.watch(keyAddress);
    return client.smembers(keyAddress);
  }
}
