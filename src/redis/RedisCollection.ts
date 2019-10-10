import IDable from '../interfaces/IDable';
import BaseCollection from '../interfaces/BaseCollection';
import { UpdateOptions } from '../interfaces/Collection';
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

interface InternalPatch {
  sId: string;
  oldSerialised: Record<string, string | null>;
  newSerialised: Record<string, string>;
}

const notUndefined = <T>(item?: T): item is T => (item !== undefined);

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
  private readonly keyPrefixes: { [K in keyof T]?: string } = {};

  private readonly uniqueKeys: Key<T>[] = [];

  private readonly nonUniqueKeys: Key<T>[] = [];

  public constructor(
    private readonly pool: RedisConnectionPool,
    private readonly prefix: string,
    keys: DBKeys<T> = {},
  ) {
    super(keys);

    Object.keys(keys).forEach((k) => {
      const key = k as keyof DBKeys<T>;
      const keyPrefix = `${prefix}-${key}`;
      this.keyPrefixes[key] = keyPrefix;
      const keyInfo = { key, prefix: keyPrefix };
      if (keys[key]!.unique) {
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

  protected internalUpdate<K extends keyof T & string>(
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
          const insertValue = { ...patchSerialised, id: sKey };
          if (!await this.runAdd(client, insertValue, true)) {
            throw new Error('duplicate');
          }
        }
      }, unwatchAll);
    }

    return this.pool.retryWithConnection(async (client) => {
      const sIds = await this.getAndWatchBySerialisedKey(client, searchAttribute, sKey);
      const patches = (await mapAwaitSync(
        sIds,
        (sId) => this.getUpdatePatch(client, sId, patchSerialised),
      )).filter(notUndefined);
      await this.runUpdates(client, patches);
    }, unwatchAll);
  }

  protected internalGet<
    K extends keyof T & string,
    F extends readonly (keyof T & string)[]
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
      return results[0] || null;
    }, unwatchAll);
  }

  protected internalGetAll<
    K extends keyof T & string,
    F extends readonly (keyof T & string)[]
  >(
    searchAttribute?: K,
    searchValue?: T[K],
    returnAttributes?: F,
  ): Promise<Readonly<Pick<T, F[-1]>>[]> {
    return this.pool.retryWithConnection(async (client) => {
      let sIds: string[];
      if (searchAttribute) {
        const sKey = serialiseValue(searchValue);
        sIds = await this.getAndWatchBySerialisedKey(client, searchAttribute, sKey);
      } else {
        sIds = await client.keys(this.makeKey('*'));
        const cut = this.prefix.length + 1;
        sIds = sIds.map((v) => v.substr(cut));
      }
      return this.getByKeysKeepWatches(client, sIds, returnAttributes);
    }, unwatchAll);
  }

  protected internalRemove<K extends keyof T & string>(
    searchAttribute: K,
    searchValue: T[K],
  ): Promise<number> {
    const sKey = serialiseValue(searchValue);
    const indexedKeys = Object.keys(this.keys);
    indexedKeys.push('id');

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
        const uniqueKeys = makeIndexKeys(this.uniqueKeys, item);
        const nonUniqueKeys = makeIndexKeys(this.nonUniqueKeys, item);
        pipeline.remove(
          1 + uniqueKeys.length + nonUniqueKeys.length,
          this.makeKey(item.id!),
          ...uniqueKeys,
          ...nonUniqueKeys,
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

  private async runAdd(
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

  private async getUpdatePatch(
    client: ERedis,
    sId: string,
    patchSerialised: Record<string, string>,
  ): Promise<InternalPatch | undefined> {
    await client.watch(this.makeKey(sId));
    const oldSerialised = await this.rawByKeyKeepWatches(
      client,
      sId,
      Object.keys(this.keys).filter((k) => patchSerialised[k]),
    );
    if (!oldSerialised) {
      return undefined;
    }
    const newSerialised = { ...patchSerialised };
    Object.keys(newSerialised).forEach((k) => {
      if (oldSerialised[k] === newSerialised[k]) {
        delete newSerialised[k];
        delete oldSerialised[k];
      }
    });
    return { sId, newSerialised, oldSerialised };
  }

  private async runUpdates(
    client: ERedis,
    patches: InternalPatch[],
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
    { sId, oldSerialised, newSerialised }: InternalPatch,
  ): [number, any[]] | undefined {
    const diff = Object.entries(newSerialised).flat();
    if (!diff.length) {
      return undefined; // nothing changed
    }
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
    fields?: readonly string[],
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
