import type Redis from 'ioredis';
import {
  type IDable,
  BaseCollection,
  type UpdateOptions,
  serialiseValue,
  serialiseRecord,
  deserialiseRecord,
  type Serialised,
  type CollectionOptions,
} from '../core/index.mts';
import type { RedisConnectionPool } from './RedisConnectionPool.mts';
import { multiExec } from './helpers.mts';
import type { ERedis } from './scripts.mts';

interface Key<T> {
  key: string & keyof T;
  prefix: string;
}

interface InternalPatch<T> {
  _sId: string;
  _oldSerialised: Serialised<T>;
  _newSerialised: Serialised<T>;
}

const notUndefined = <T,>(item?: T): item is T => item !== undefined;

function makeIndexKeys<T>(keys: Key<T>[], partialSerialisedValue: Serialised<T>): string[] {
  return keys
    .filter(({ key }) => partialSerialisedValue.has(key))
    .map(({ key, prefix }) => `${prefix}:${partialSerialisedValue.get(key)}`);
}

function parseItem<T>(
  item: (string | null)[],
  attributes?: readonly (string & keyof T)[],
): Serialised<T> | undefined {
  if (!item.length) {
    return undefined;
  }
  const result = new Map<string & keyof T, string>();
  if (attributes) {
    // item is values in same order as attributes
    attributes.forEach((attr, index) => {
      const v = item[index];
      if (v) {
        result.set(attr, v);
      }
    });
  } else {
    // item is key1, value1, key2, value2, ...
    for (let i = 0; i < item.length; i += 2) {
      const attr = item[i];
      const v = item[i + 1];
      if (v) {
        result.set(attr as string & keyof T, v);
      }
    }
  }
  return result.size > 0 ? result : undefined;
}

async function unwatchAll(client: Redis): Promise<void> {
  await client.unwatch();
}

async function mapAwaitSync<T, O>(values: T[], fn: (value: T) => Promise<O>): Promise<O[]> {
  const result: O[] = [];
  for (const v of values) {
    result.push(await fn(v));
  }
  return result;
}

export class RedisCollection<T extends IDable> extends BaseCollection<T> {
  /** @internal */ private readonly _pool: RedisConnectionPool;
  /** @internal */ private readonly _prefix: string;
  /** @internal */ private readonly _keyPrefixes = new Map<string & keyof T, string>();
  /** @internal */ private readonly _uniqueKeys: Key<T>[] = [];
  /** @internal */ private readonly _nonUniqueKeys: Key<T>[] = [];

  /** @internal */ constructor(options: CollectionOptions<T>, pool: RedisConnectionPool) {
    super(options);
    this._pool = pool;
    this._prefix = options.name;

    for (const key of this.indices.getCustomIndices()) {
      const keyPrefix = `${this._prefix}-${key}`;
      this._keyPrefixes.set(key, keyPrefix);
      const keyInfo = { key, prefix: keyPrefix };
      if (this.indices.isUniqueIndex(key)) {
        this._uniqueKeys.push(keyInfo);
      } else {
        this._nonUniqueKeys.push(keyInfo);
      }
    }
  }

  protected override async internalAddBatch(values: T[]) {
    await this._pool.withConnection(async (client) => {
      for (const value of values) {
        const sRecord = serialiseRecord(value);
        const added = await this._runAdd(client, sRecord, false);
        if (!added) {
          throw new Error('duplicate');
        }
      }
    });
  }

  protected override internalUpdate<K extends string & keyof T>(
    filterAttribute: K,
    filterValue: T[K],
    delta: Partial<T>,
    { upsert }: UpdateOptions,
  ): Promise<void> {
    const sDelta = serialiseRecord(delta);
    const sValue = serialiseValue(filterValue);

    if (filterAttribute === 'id') {
      return this._pool.retryWithConnection(async (client) => {
        const patch = await this._getUpdatePatch(client, sValue, sDelta);
        if (patch) {
          await this._runUpdates(client, [patch]);
        } else if (upsert) {
          const insertValue = new Map(sDelta).set('id', sValue);
          if (!(await this._runAdd(client, insertValue, true))) {
            throw new Error('duplicate');
          }
        }
      }, unwatchAll);
    }

    return this._pool.retryWithConnection(async (client) => {
      const sIds = await this._getAndWatchBySerialisedFilter(client, filterAttribute, sValue);
      if (!sIds.length) {
        return;
      }
      if (
        delta.id &&
        filterAttribute !== 'id' &&
        (sIds.length > 1 || serialiseValue(delta.id) !== sIds[0])
      ) {
        throw new Error('Cannot update ID');
      }
      const patches = (
        await mapAwaitSync(sIds, (sId) => this._getUpdatePatch(client, sId, sDelta))
      ).filter(notUndefined);
      await this._runUpdates(client, patches);
    }, unwatchAll);
  }

  protected override internalGetAll<
    K extends string & keyof T,
    F extends readonly (string & keyof T)[],
  >(filterAttribute: K | undefined, filterValue: T[K] | undefined, returnAttributes?: F) {
    const self = this;
    if (filterAttribute) {
      const sValue = serialiseValue(filterValue);
      return this._pool.retryWithConnectionGen(async function* (client) {
        const sIds = await self._getAndWatchBySerialisedFilter(client, filterAttribute, sValue);
        yield* self._getByKeysKeepWatches(client, sIds, returnAttributes);
      }, unwatchAll);
    }

    return this._pool.retryWithConnectionGen(async function* (client) {
      const cut = self._prefix.length + 1;
      const stream = client.scanStream({
        match: self._makeKey('*'),
        count: 100,
      });
      try {
        for await (const batch of stream) {
          const sIds = (batch as string[]).map((v) => v.substring(cut));
          yield* self._getByKeysKeepWatches(client, sIds, returnAttributes);
        }
      } finally {
        stream.close();
      }
    }, unwatchAll);
  }

  protected override internalRemove<K extends string & keyof T>(
    filterAttribute: K | undefined,
    filterValue: T[K] | undefined,
  ): Promise<number> {
    const indices = this.indices.getIndices();

    if (!filterAttribute) {
      return this._pool.retryWithConnection(async (client) => {
        const cut = this._prefix.length + 1;
        const stream = client.scanStream({
          match: this._makeKey('*'),
          count: 100,
        });
        try {
          let n = 0;
          for await (const batch of stream) {
            const sIds = (batch as string[]).map((v) => v.substring(cut));
            const items = (
              await mapAwaitSync(sIds, (sId) =>
                this._getRawBySerialisedIdKeepWatches(client, sId, indices),
              )
            ).filter(notUndefined);

            if (items.length === 0) {
              continue;
            }

            const pipeline = client.multi();
            for (const item of items) {
              const id = item.get('id')!;
              const uniqueKeys = makeIndexKeys(this._uniqueKeys, item);
              const nonUniqueKeys = makeIndexKeys(this._nonUniqueKeys, item);
              pipeline.remove(
                1 + uniqueKeys.length + nonUniqueKeys.length,
                this._makeKey(id),
                ...uniqueKeys,
                ...nonUniqueKeys,
                id,
              );
            }
            await pipeline.exec();
            n += items.length;
          }
          return n;
        } finally {
          stream.close();
        }
      }, unwatchAll);
    }

    const sValue = serialiseValue(filterValue);

    return this._pool.retryWithConnection(async (client) => {
      const sIds = await this._getAndWatchBySerialisedFilter(client, filterAttribute, sValue);
      const items = (
        await mapAwaitSync(sIds, (sId) =>
          this._getRawBySerialisedIdKeepWatches(client, sId, indices),
        )
      ).filter(notUndefined);

      if (items.length === 0) {
        return 0;
      }

      const pipeline = client.multi();
      for (const item of items) {
        const id = item.get('id')!;
        const uniqueKeys = makeIndexKeys(this._uniqueKeys, item);
        const nonUniqueKeys = makeIndexKeys(this._nonUniqueKeys, item);
        pipeline.remove(
          1 + uniqueKeys.length + nonUniqueKeys.length,
          this._makeKey(id),
          ...uniqueKeys,
          ...nonUniqueKeys,
          id,
        );
      }
      await pipeline.exec();
      return items.length;
    }, unwatchAll);
  }

  /** @internal */ private _makeKey(serialisedId: string): string {
    return `${this._prefix}:${serialisedId}`;
  }

  /** @internal */ private async _runAdd(
    client: ERedis,
    serialised: Serialised<T>,
    checkWatch: boolean,
  ): Promise<boolean> {
    const sId = serialised.get('id')!;
    const uniqueKeys = makeIndexKeys(this._uniqueKeys, serialised);
    const nonUniqueKeys = makeIndexKeys(this._nonUniqueKeys, serialised);

    const keyCount = 1 + uniqueKeys.length + nonUniqueKeys.length;
    const params = [
      this._makeKey(sId),
      ...uniqueKeys,
      ...nonUniqueKeys,
      uniqueKeys.length,
      'id', // ID is always first in flattened key/value pairs
      sId,
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
    return Boolean(result[0]?.[1]);
  }

  /** @internal */ private async _getUpdatePatch(
    client: Redis,
    sId: string,
    sDelta: Serialised<T>,
  ): Promise<InternalPatch<T> | undefined> {
    await client.watch(this._makeKey(sId));
    const oldSerialised = await this._getRawBySerialisedIdKeepWatches(
      client,
      sId,
      this.indices.getCustomIndices().filter((k) => sDelta.has(k)),
    );
    if (!oldSerialised) {
      return undefined;
    }
    const newSerialised = new Map(sDelta);
    sDelta.forEach((n, k) => {
      if (oldSerialised.get(k) === n) {
        newSerialised.delete(k);
        oldSerialised.delete(k);
      }
    });
    return { _sId: sId, _newSerialised: newSerialised, _oldSerialised: oldSerialised };
  }

  /** @internal */ private async _runUpdates(
    client: ERedis,
    patches: InternalPatch<T>[],
  ): Promise<void> {
    const argsList = patches.map((patch) => this._makeUpdateArgs(patch)).filter(notUndefined);

    if (!argsList.length) {
      return;
    }

    if (argsList.length === 1) {
      const results = await client.multi().update(argsList[0]![0], argsList[0]![1]).exec();

      if (!results) {
        throw new Error('transient error');
      }
      if (!results[0]?.[1]) {
        throw new Error('duplicate');
      }
      return;
    }

    const updateCheckResults = await mapAwaitSync(argsList, (updateArgs) =>
      client.checkUpdate(updateArgs[0], updateArgs[1]),
    );
    if (updateCheckResults.some((r) => !r)) {
      throw new Error('duplicate');
    }

    let chain = client.multi();
    for (const updateArgs of argsList) {
      chain = chain.updateWithoutCheck(updateArgs[0], updateArgs[1]);
    }
    const results = await chain.exec();

    if (!results) {
      throw new Error('transient error');
    }
  }

  /** @internal */ private _makeUpdateArgs({
    _sId,
    _oldSerialised,
    _newSerialised,
  }: InternalPatch<T>): [number, unknown[]] | undefined {
    if (!_newSerialised.size) {
      return undefined; // nothing changed
    }
    const diff = [..._newSerialised.entries()].flat();
    const patchUniqueKeys = makeIndexKeys(this._uniqueKeys, _newSerialised);
    const patch_NonUniqueKeys = makeIndexKeys(this._nonUniqueKeys, _newSerialised);
    const oldUniqueKeys = makeIndexKeys(this._uniqueKeys, _oldSerialised);
    const old_NonUniqueKeys = makeIndexKeys(this._nonUniqueKeys, _oldSerialised);
    if (
      oldUniqueKeys.length !== patchUniqueKeys.length ||
      old_NonUniqueKeys.length !== patch_NonUniqueKeys.length
    ) {
      throw new Error('unexpected key mismatch with old value');
    }
    const keyCount = 1 + (patchUniqueKeys.length + patch_NonUniqueKeys.length) * 2;
    const params = [
      this._makeKey(_sId),
      ...patchUniqueKeys,
      ...patch_NonUniqueKeys,
      ...oldUniqueKeys,
      ...old_NonUniqueKeys,
      patchUniqueKeys.length,
      patchUniqueKeys.length + patch_NonUniqueKeys.length,
      _sId,
      ...diff,
    ];
    return [keyCount, params];
  }

  /** @internal */ private async *_getByKeysKeepWatches<F extends readonly (string & keyof T)[]>(
    client: Redis,
    serialisedIds: string[],
    attributes?: F,
  ): AsyncGenerator<Readonly<Pick<T, F[number]>>, void, undefined> {
    if (!serialisedIds.length) {
      return;
    }

    if (attributes?.length === 0) {
      const count = await client.exists(serialisedIds.map((sId) => this._makeKey(sId)));
      for (let i = 0; i < count; ++i) {
        yield {} as Pick<T, F[number]>;
      }
      return;
    }

    const results = await multiExec(
      client,
      serialisedIds.map((sId) => {
        const k = this._makeKey(sId);
        return attributes ? ['hmget', k, ...attributes] : ['hgetall', k];
      }),
    );
    if (!results) {
      throw new Error('transient error');
    }
    for (const [, item] of results) {
      const value = parseItem<T>(item, attributes);
      if (value !== undefined) {
        yield deserialiseRecord(value);
      }
    }
  }

  /** @internal */ private async _getRawBySerialisedIdKeepWatches(
    client: Redis,
    serialisedId: string,
    attributes?: readonly (string & keyof T)[],
  ): Promise<Serialised<T> | undefined> {
    const key = this._makeKey(serialisedId);
    if (!attributes) {
      return parseItem((await client.hgetall(key)) as unknown as string[]);
    }
    if (!attributes.length) {
      // just check existence
      const exists = await client.exists(key);
      return exists ? new Map() : undefined;
    }
    return parseItem(await client.hmget(key, ...attributes), attributes);
  }

  /** @internal */ private async _getAndWatchBySerialisedFilter(
    client: Redis,
    attribute: string & keyof T,
    sValue: string,
  ): Promise<string[]> {
    if (attribute === 'id') {
      return [sValue];
    }
    const keyPrefix = this._keyPrefixes.get(attribute);
    if (!keyPrefix) {
      throw new Error(`Requested attribute ${attribute} not indexed`);
    }
    const keyAddress = `${keyPrefix}:${sValue}`;
    await client.watch(keyAddress);
    return client.smembers(keyAddress);
  }
}
