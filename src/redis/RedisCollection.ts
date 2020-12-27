import type { IDable } from '../interfaces/IDable';
import BaseCollection from '../interfaces/BaseCollection';
import type { UpdateOptions } from '../interfaces/Collection';
import type { DBKeys } from '../interfaces/DB';
import {
  serialiseValue,
  serialiseRecord,
  deserialiseRecord,
  Serialised,
} from '../helpers/serialiser';
import type RedisConnectionPool from './RedisConnectionPool';
import { multiExec } from './helpers';
import type { ERedis } from './scripts';

interface Key<T> {
  key: string & keyof T;
  prefix: string;
}

interface InternalPatch<T> {
  sId: string;
  oldSerialised: Serialised<T>;
  newSerialised: Serialised<T>;
}

const notUndefined = <T>(item?: T): item is T => (item !== undefined);

function makeIndexKeys<T>(
  keys: Key<T>[],
  partialSerialisedValue: Serialised<T>,
): string[] {
  return keys
    .filter(({ key }) => partialSerialisedValue.has(key))
    .map(({ key, prefix }) => `${prefix}:${partialSerialisedValue.get(key)}`);
}

function parseItem<T>(
  item: (string | null)[],
  fields?: readonly (string & keyof T)[],
): Serialised<T> | undefined {
  if (!item.length) {
    return undefined;
  }
  const result = new Map<string & keyof T, string>();
  if (fields) {
    // item is values in same order as fields
    fields.forEach((field, index) => {
      const v = item[index];
      if (v) {
        result.set(field, v);
      }
    });
  } else {
    // item is key1, value1, key2, value2, ...
    for (let i = 0; i < item.length; i += 2) {
      const field = item[i];
      const v = item[i + 1];
      if (v) {
        result.set(field as (string & keyof T), v);
      }
    }
  }
  return result.size > 0 ? result : undefined;
}

async function unwatchAll(client: ERedis): Promise<void> {
  await client.unwatch();
}

async function mapAwaitSync<T, O>(
  values: T[],
  fn: (value: T) => Promise<O>,
): Promise<O[]> {
  const result: O[] = [];
  for (let i = 0; i < values.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    result.push(await fn(values[i]));
  }
  return result;
}

export default class RedisCollection<T extends IDable> extends BaseCollection<T> {
  private readonly keyPrefixes = new Map<string & keyof T, string>();

  private readonly uniqueKeys: Key<T>[] = [];

  private readonly nonUniqueKeys: Key<T>[] = [];

  public constructor(
    private readonly pool: RedisConnectionPool,
    private readonly prefix: string,
    keys: DBKeys<T> = {},
  ) {
    super(keys);

    this.indices.getCustomIndices().forEach((key) => {
      const keyPrefix = `${prefix}-${key}`;
      this.keyPrefixes.set(key, keyPrefix);
      const keyInfo = { key, prefix: keyPrefix };
      if (this.indices.isUniqueIndex(key)) {
        this.uniqueKeys.push(keyInfo);
      } else {
        this.nonUniqueKeys.push(keyInfo);
      }
    });
  }

  protected internalAdd(value: T): Promise<void> {
    const serialised = serialiseRecord(value);
    return this.pool.withConnection(async (client) => {
      const added = await this.runAdd(client, serialised, false);
      if (!added) {
        throw new Error('duplicate');
      }
    });
  }

  protected internalUpdate<K extends string & keyof T>(
    searchAttribute: K,
    searchValue: T[K],
    update: Partial<T>,
    { upsert }: UpdateOptions,
  ): Promise<void> {
    const patchSerialised = serialiseRecord(update);
    const sKey = serialiseValue(searchValue);

    if (searchAttribute === 'id') {
      return this.pool.retryWithConnection(async (client) => {
        const patch = await this.getUpdatePatch(client, sKey, patchSerialised);
        if (patch) {
          await this.runUpdates(client, [patch]);
        } else if (upsert) {
          const insertValue = new Map(patchSerialised).set('id', sKey);
          if (!await this.runAdd(client, insertValue, true)) {
            throw new Error('duplicate');
          }
        }
      }, unwatchAll);
    }

    return this.pool.retryWithConnection(async (client) => {
      const sIds = await this.getAndWatchBySerialisedKey(client, searchAttribute, sKey);
      if (!sIds.length) {
        return;
      }
      if (
        update.id &&
        searchAttribute !== 'id' &&
        (sIds.length > 1 || serialiseValue(update.id) !== sIds[0])
      ) {
        throw new Error('Cannot update ID');
      }
      const patches = (await mapAwaitSync(
        sIds,
        (sId) => this.getUpdatePatch(client, sId, patchSerialised),
      )).filter(notUndefined);
      await this.runUpdates(client, patches);
    }, unwatchAll);
  }

  protected internalGet<
    K extends string & keyof T,
    F extends readonly (string & keyof T)[]
  >(
    searchAttribute: K,
    searchValue: T[K],
    returnAttributes?: F,
  ): Promise<Readonly<Pick<T, F[-1]>> | null> {
    const sKey = serialiseValue(searchValue);
    return this.pool.retryWithConnection(async (client) => {
      const sId = (await this.getAndWatchBySerialisedKey(client, searchAttribute, sKey))[0];
      if (sId === undefined) {
        return null;
      }
      const results = await this.getByKeysKeepWatches(client, [sId], returnAttributes);
      return results[0] ?? null;
    }, unwatchAll);
  }

  protected internalGetAll<
    K extends string & keyof T,
    F extends readonly (string & keyof T)[]
  >(
    searchAttribute?: K,
    searchValue?: T[K],
    returnAttributes?: F,
  ): Promise<Readonly<Pick<T, F[-1]>>[]> {
    if (searchAttribute) {
      return this.pool.retryWithConnection(async (client) => {
        const sKey = serialiseValue(searchValue);
        const sIds = await this.getAndWatchBySerialisedKey(client, searchAttribute, sKey);
        return this.getByKeysKeepWatches(client, sIds, returnAttributes);
      }, unwatchAll);
    }

    const cut = this.prefix.length + 1;
    return this.pool.retryWithConnection(async (client) => {
      const stream = client.scanStream({ match: this.makeKey('*'), count: 100 });
      const result: Pick<T, F[-1]>[] = [];
      /* eslint-disable-next-line no-restricted-syntax */ // supported natively in Node 10+
      for await (const batch of stream) {
        const sIds = (batch as string[]).map((v) => v.substr(cut));
        result.push(...await this.getByKeysKeepWatches(client, sIds, returnAttributes));
      }
      return result;
    }, unwatchAll);
  }

  protected internalRemove<K extends string & keyof T>(
    searchAttribute: K,
    searchValue: T[K],
  ): Promise<number> {
    const sKey = serialiseValue(searchValue);
    const indexedKeys = this.indices.getIndices();

    return this.pool.retryWithConnection(async (client) => {
      const sIds = await this.getAndWatchBySerialisedKey(client, searchAttribute, sKey);
      const items = (await mapAwaitSync(
        sIds,
        (sId) => this.rawByKeyKeepWatches(client, sId, indexedKeys),
      )).filter(notUndefined);

      if (items.length === 0) {
        return 0;
      }

      const pipeline = client.multi();
      items.forEach((item) => {
        const id = item.get('id')!;
        const uniqueKeys = makeIndexKeys(this.uniqueKeys, item);
        const nonUniqueKeys = makeIndexKeys(this.nonUniqueKeys, item);
        pipeline.remove(
          1 + uniqueKeys.length + nonUniqueKeys.length,
          this.makeKey(id),
          ...uniqueKeys,
          ...nonUniqueKeys,
          id,
        );
      });
      await pipeline.exec();
      return items.length;
    }, unwatchAll);
  }

  private makeKey(serialisedId: string): string {
    return `${this.prefix}:${serialisedId}`;
  }

  private async runAdd(
    client: ERedis,
    serialised: Serialised<T>,
    checkWatch: boolean,
  ): Promise<boolean> {
    const id = serialised.get('id')!;
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
      ...[...serialised.entries()].filter(([k]) => k !== 'id').flat(),
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

  private async getUpdatePatch(
    client: ERedis,
    sId: string,
    patchSerialised: Serialised<T>,
  ): Promise<InternalPatch<T> | undefined> {
    await client.watch(this.makeKey(sId));
    const oldSerialised = await this.rawByKeyKeepWatches(
      client,
      sId,
      this.indices.getCustomIndices().filter((k) => patchSerialised.has(k)),
    );
    if (!oldSerialised) {
      return undefined;
    }
    const newSerialised = new Map(patchSerialised);
    patchSerialised.forEach((n, k) => {
      if (oldSerialised.get(k) === n) {
        newSerialised.delete(k);
        oldSerialised.delete(k);
      }
    });
    return { sId, newSerialised, oldSerialised };
  }

  private async runUpdates(
    client: ERedis,
    patches: InternalPatch<T>[],
  ): Promise<void> {
    const argsList = patches
      .map((patch) => this.makeUpdateArgs(patch))
      .filter(notUndefined);

    if (!argsList.length) {
      return;
    }

    if (argsList.length === 1) {
      const results = await client.multi()
        .update(argsList[0][0], argsList[0][1])
        .exec();

      if (!results) {
        throw new Error('transient error');
      }
      if (!results[0][1]) {
        throw new Error('duplicate');
      }
      return;
    }

    const updateCheckResults = await mapAwaitSync(
      argsList,
      (updateArgs) => client.checkUpdate(updateArgs[0], updateArgs[1]),
    );
    if (updateCheckResults.some((r) => !r)) {
      throw new Error('duplicate');
    }

    let chain = client.multi();
    argsList.forEach((updateArgs) => {
      chain = chain.updateWithoutCheck(updateArgs[0], updateArgs[1]);
    });
    const results = await chain.exec();

    if (!results) {
      throw new Error('transient error');
    }
  }

  private makeUpdateArgs(
    { sId, oldSerialised, newSerialised }: InternalPatch<T>,
  ): [number, unknown[]] | undefined {
    if (!newSerialised.size) {
      return undefined; // nothing changed
    }
    const diff = [...newSerialised.entries()].flat();
    const patchUniqueKeys = makeIndexKeys(this.uniqueKeys, newSerialised);
    const patchNonUniqueKeys = makeIndexKeys(this.nonUniqueKeys, newSerialised);
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
      this.makeKey(sId),
      ...patchUniqueKeys,
      ...patchNonUniqueKeys,
      ...oldUniqueKeys,
      ...oldNonUniqueKeys,
      patchUniqueKeys.length,
      patchUniqueKeys.length + patchNonUniqueKeys.length,
      sId,
      ...diff,
    ];
    return [keyCount, params];
  }

  private async getByKeysKeepWatches<F extends readonly (string & keyof T)[]>(
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
      .map(([, item]) => parseItem<T>(item, fields))
      .filter(notUndefined)
      .map(deserialiseRecord);
  }

  private async rawByKeyKeepWatches(
    client: ERedis,
    serialisedId: string,
    fields?: readonly (string & keyof T)[],
  ): Promise<Serialised<T> | undefined> {
    const key = this.makeKey(serialisedId);
    if (!fields) {
      return parseItem((await client.hgetall(key)) as unknown as string[]);
    }
    if (!fields.length) {
      // just check existence
      const exists = await client.exists(key);
      return exists ? new Map() : undefined;
    }
    return parseItem(await client.hmget(key, ...fields), fields);
  }

  private async getAndWatchBySerialisedKey(
    client: ERedis,
    keyName: string & keyof T,
    serialisedValue: string,
  ): Promise<string[]> {
    if (keyName === 'id') {
      return [serialisedValue];
    }
    const keyPrefix = this.keyPrefixes.get(keyName);
    if (!keyPrefix) {
      throw new Error(`Requested key ${keyName} not indexed`);
    }
    const keyAddress = `${keyPrefix}:${serialisedValue}`;
    await client.watch(keyAddress);
    return client.smembers(keyAddress);
  }
}
