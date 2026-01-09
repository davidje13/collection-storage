import {
  type IDable,
  BaseCollection,
  type CollectionOptions,
  serialiseValueBin,
  deserialiseValueBin,
  makeKeyValue,
  mapEntries,
  safeGet,
  DuplicateError,
} from '../core/index.mts';
import {
  DDB,
  type DDBItem,
  type DDBValue,
  escapeName,
  type DDBProvisionedThroughput,
} from './api/DDB.mts';
import { AWSError } from './api/AWSError.mts';

const ConditionalCheckFailedException = 'ConditionalCheckFailedException';

async function runAll<T>(
  values: T[],
  successesOut: T[],
  fn: (value: T) => Promise<void>,
): Promise<void> {
  const results = await Promise.allSettled(
    values.map(async (value) => {
      await fn(value);
      successesOut.push(value);
    }),
  );
  const failures = results.filter((s) => s.status === 'rejected') as PromiseRejectedResult[];
  if (failures.length) {
    throw failures[0]!.reason;
  }
}

function wrapError(type: string, errorFn: () => Error): (e: unknown) => void {
  return (e): void => {
    throw AWSError.isType(e, type) ? errorFn() : e;
  };
}

function handleError<T>(type: string, fn: () => Promise<T> | T): (e: unknown) => Promise<T> | T {
  return (e): Promise<T> | T => {
    if (AWSError.isType(e, type)) {
      return fn();
    }
    throw e;
  };
}

const ignore = (): void => {};

function toDynamoValue(value: unknown): DDBValue {
  // all values must be binary, because keys must be defined
  // in advance before we know what type of data will be stored
  // and any column could be a key (or become one in the future)
  const bin = serialiseValueBin(value);
  return { B: bin.toString('base64') };
}

function toDynamoItem(value: Record<string, unknown>): DDBItem {
  return mapEntries(value, toDynamoValue);
}

function isDynamoBinary(value: DDBValue): value is { B: string } {
  return Object.prototype.hasOwnProperty.call(value, 'B');
}

function isDynamoStringSet(value: DDBValue): value is { SS: string[] } {
  return Object.prototype.hasOwnProperty.call(value, 'SS');
}

function fromDynamoValue(value: DDBValue): unknown {
  if (isDynamoBinary(value)) {
    return deserialiseValueBin(Buffer.from(value.B, 'base64'));
  }
  throw new Error(
    `unexpected value type from DDB: ${value && typeof value === 'object' ? Object.keys(value) : typeof value}`,
  );
}

function fromDynamoItem<T = Record<string, unknown>>(value: DDBItem): T;
function fromDynamoItem<T = Record<string, unknown>>(value: DDBItem | null | undefined): T | null;

function fromDynamoItem<T = Record<string, unknown>>(value: DDBItem | null | undefined): T | null {
  if (!value) {
    return null;
  }
  return mapEntries(value, fromDynamoValue) as T;
}

function toDynamoKey(attr: string, value: DDBValue): DDBValue {
  if (!isDynamoBinary(value)) {
    throw new Error(
      `unexpected value type from DDB: ${value && typeof value === 'object' ? Object.keys(value) : typeof value}`,
    );
  }
  return {
    B: Buffer.concat([Buffer.from(`${attr}:`, 'utf8'), Buffer.from(value.B, 'base64')]).toString(
      'base64',
    ),
  };
}

const INDEX_META_KEY = { B: Buffer.from(':').toString('base64') };

const indexTable = (tableName: string): string => `${tableName}.`;

export interface Throughput {
  read: number;
  write: number;
}

type CollectionThroughputFn = (indexName: string | null) => Throughput | null | undefined;

function toDDBThroughput(
  throughput: Throughput | null | undefined,
): DDBProvisionedThroughput | undefined {
  if (!throughput) {
    return undefined;
  }
  return {
    ReadCapacityUnits: Math.max(1, Math.ceil(throughput.read)),
    WriteCapacityUnits: Math.max(1, Math.ceil(throughput.write)),
  };
}

function getCombinedThroughput(
  keys: string[],
  throughputFn?: CollectionThroughputFn,
): Throughput | null {
  const totalThroughput = { read: 0, write: 0 };
  let hasThroughput = false;
  for (const attr of keys) {
    const cur = throughputFn?.(attr);
    if (cur) {
      hasThroughput = true;
      totalThroughput.read += cur.read;
      totalThroughput.write += cur.write;
    }
  }
  return hasThroughput ? totalThroughput : null;
}

async function configureTable(
  ddb: DDB,
  tableName: string,
  nonuniqueKeys: string[],
  uniqueKeys: string[],
  throughputFn?: CollectionThroughputFn,
): Promise<void> {
  const indexTableName = indexTable(tableName);

  const [created] = await Promise.all([
    ddb.upsertTable(
      tableName,
      [{ attributeName: 'id', attributeType: 'B', keyType: 'HASH' }],
      nonuniqueKeys.map((attr) => ({
        indexName: escapeName(attr),
        keySchema: [{ attributeName: attr, attributeType: 'B', keyType: 'HASH' }],
        throughput: toDDBThroughput(throughputFn?.(attr)),
      })),
      true,
      toDDBThroughput(throughputFn?.(null)),
    ),
    uniqueKeys.length
      ? ddb.upsertTable(
          indexTableName,
          [{ attributeName: 'ix', attributeType: 'B', keyType: 'HASH' }],
          [],
          true,
          toDDBThroughput(getCombinedThroughput(uniqueKeys, throughputFn)),
        )
      : ddb.deleteTable(indexTableName).catch(ignore),
  ]);

  if (created || !uniqueKeys.length) {
    return;
  }

  // table already existed; might need to migrate old data for unique indices
  const info = await ddb.getItem(indexTableName, { ix: INDEX_META_KEY }, ['unique']);
  const newKeys = new Set(uniqueKeys);
  const oldKeys: string[] = [];
  if (info && isDynamoStringSet(info['unique']!)) {
    oldKeys.push(...info['unique']!.SS.filter((item) => !newKeys.delete(item)));
  }
  if (newKeys.size) {
    // we have new keys which must be populated
    const attrs = [...newKeys];
    await ddb.getAllItems(tableName, ['id', ...attrs]).batched(async (items) => {
      const indexItems: DDBItem[] = [];
      for (const item of items) {
        for (const attr of attrs) {
          const value = safeGet(item, attr);
          if (!value) {
            throw new Error(`Unable to migrate existing data (no value for ${tableName}.${attr})`);
          }
          indexItems.push({ ix: toDynamoKey(attr, value), id: item['id']! });
        }
      }
      return ddb.batchPutItems(indexTableName, indexItems);
    });
  } else if (!oldKeys.length) {
    return; // no change
  }
  // do not delete old items; storing them is relatively
  // cheap compared to scanning and deleting them

  // update stored info about indices
  await ddb.putItem(indexTableName, {
    ix: INDEX_META_KEY,
    unique: { SS: uniqueKeys },
  });
}

export class DynamoCollection<T extends IDable> extends BaseCollection<T> {
  /** @internal */ private readonly _ddb: DDB;
  /** @internal */ private readonly _tableName: string;
  /** @internal */ private readonly _uniqueKeys: (string & keyof T)[] = [];

  /** @internal */ constructor(
    options: CollectionOptions<T>,
    ddb: DDB,
    tableName: string,
    throughputFn?: CollectionThroughputFn,
  ) {
    super(options);
    this._ddb = ddb;
    this._tableName = tableName;

    const nonuniqueKeys: (string & keyof T)[] = [];
    for (const [key, keyOptions] of Object.entries(options.keys)) {
      if (keyOptions?.unique) {
        this._uniqueKeys.push(key as string & keyof T);
      } else {
        nonuniqueKeys.push(key as string & keyof T);
      }
    }

    this.initAsync(configureTable(ddb, tableName, nonuniqueKeys, this._uniqueKeys, throughputFn));
  }

  get internalTableName(): string {
    return this._tableName;
  }

  get internalIndexTableName(): string {
    return indexTable(this._tableName);
  }

  protected override internalAddBatch(entries: T[]): Promise<void> {
    return this._putItems((entries as any[]).map(toDynamoItem));
  }

  /** @internal */ protected override internalUpsert(
    id: T['id'],
    delta: Partial<T>,
  ): Promise<void> {
    const ddbDelta = toDynamoItem({ id, ...delta });
    const ddbID = ddbDelta['id']!;
    const key = { id: ddbID };
    delete ddbDelta['id'];

    // optimistically try to update
    return this._updateItem(key, ddbDelta, key).catch(
      handleError(
        ConditionalCheckFailedException,

        // if that fails due to the item not existing, try creating it
        () =>
          this._atomicPutUniques(ddbID, ddbDelta, this._uniqueKeys, () =>
            this._ddb.putItem(this._tableName, { ...key, ...ddbDelta }, 'id'),
          ).catch(
            handleError(
              ConditionalCheckFailedException,

              // it that fails due to the item existing, the item was probably
              // created in the gap between calls; update it
              () =>
                this._updateItem(key, ddbDelta, key).catch(
                  wrapError(
                    ConditionalCheckFailedException,

                    // if it fails again, give up
                    () => new Error('Failed to upsert item'),
                  ),
                ),
            ),
          ),
      ),
    );
  }

  protected override async internalUpdate<K extends string & keyof T>(
    filterAttribute: K,
    filterValue: T[K],
    delta: Partial<T>,
  ): Promise<void> {
    const ddbDelta = toDynamoItem(delta);
    const setId = delta.id;
    delete ddbDelta['id'];

    if (filterAttribute === 'id') {
      await this._updateItem(toDynamoItem({ id: filterValue }), ddbDelta).catch(
        handleError(ConditionalCheckFailedException, ignore),
      );
    } else {
      const ids = await this._getIDs(filterAttribute, filterValue);
      if (!ids.length) {
        return;
      }
      if (setId && (ids.length > 1 || ids[0] !== setId)) {
        throw new Error('Cannot update ID');
      }
      const filter = toDynamoItem(makeKeyValue(filterAttribute, filterValue));
      await Promise.all(
        ids.map((id) =>
          this._updateItem(toDynamoItem({ id }), ddbDelta, filter).catch(
            handleError(ConditionalCheckFailedException, ignore),
          ),
        ),
      );
    }
  }

  /** @internal */ private async _getIDs<K extends string & keyof T>(
    attribute: K | undefined,
    value: T[K] | undefined,
  ) {
    const ids: T['id'][] = [];
    for await (const item of this.internalGetAll(attribute, value, ['id'])) {
      ids.push(item.id);
    }
    return ids;
  }

  /** @internal */ protected override async internalGet<
    K extends string & keyof T,
    F extends readonly (string & keyof T)[],
  >(
    filterAttribute: K | undefined,
    filterValue: T[K] | undefined,
    returnAttributes?: F,
  ): Promise<Readonly<Pick<T, F[number]>> | null> {
    if (!filterAttribute) {
      const item = await this._ddb.getAllItems(this._tableName, returnAttributes, true).first();
      if (item) {
        return fromDynamoItem(item) as Pick<T, F[number]>;
      }
      return null;
    }

    if (filterAttribute === 'id') {
      return fromDynamoItem<Pick<T, F[number]>>(
        await this._ddb.getItem(
          this._tableName,
          toDynamoItem({ id: filterValue }),
          returnAttributes,
        ),
      );
    }

    if (!this.indices.isUniqueIndex(filterAttribute)) {
      const ddbItems = await this._ddb.getItemsBySecondaryKey(
        this._tableName,
        escapeName(filterAttribute),
        toDynamoItem(makeKeyValue(filterAttribute, filterValue)),
        returnAttributes,
        true,
      );
      return fromDynamoItem<Pick<T, F[number]>>(ddbItems[0]);
    }

    const ddbFilterValue = toDynamoValue(filterValue);
    const key = await this._ddb.getItem(
      indexTable(this._tableName),
      { ix: toDynamoKey(filterAttribute, ddbFilterValue) },
      ['id'],
    );
    if (!key) {
      return null;
    }
    if (!returnAttributes) {
      return fromDynamoItem<Pick<T, F[number]>>(await this._ddb.getItem(this._tableName, key));
    }
    const ddbItem: DDBItem = {};
    const filteredReturn = new Set(returnAttributes);
    if (filteredReturn.delete('id')) {
      Object.assign(ddbItem, key);
    }
    if (filteredReturn.delete(filterAttribute)) {
      ddbItem[filterAttribute] = ddbFilterValue;
    }
    if (filteredReturn.size) {
      const primaryItem = await this._ddb.getItem(this._tableName, key, [...filteredReturn]);
      if (!primaryItem) {
        // index and main table are out of sync;
        // assume main table is correct and item does not exist
        return null;
      }
      Object.assign(ddbItem, primaryItem);
    }
    return fromDynamoItem<Pick<T, F[number]>>(ddbItem);
  }

  protected override async *internalGetAll<
    K extends string & keyof T,
    F extends readonly (string & keyof T)[],
  >(filterAttribute: K | undefined, filterValue: T[K] | undefined, returnAttributes?: F) {
    if (!filterAttribute) {
      const items = await this._ddb.getAllItems(this._tableName, returnAttributes).all(); // TODO: avoid loading all items in memory
      for (const item of items) {
        yield fromDynamoItem(item) as Pick<T, F[number]>;
      }
    } else if (this.indices.isUniqueIndex(filterAttribute)) {
      const item = await this.internalGet(filterAttribute, filterValue!, returnAttributes);
      if (item) {
        yield item;
      }
    } else {
      const items = await this._ddb.getItemsBySecondaryKey(
        this._tableName,
        escapeName(filterAttribute),
        toDynamoItem(makeKeyValue(filterAttribute, filterValue)),
        returnAttributes,
        false,
      );
      for (const item of items) {
        yield fromDynamoItem(item) as Pick<T, F[number]>;
      }
    }
  }

  protected override async internalRemove<K extends string & keyof T>(
    filterAttribute: K | undefined,
    filterValue: T[K] | undefined,
  ): Promise<number> {
    if (filterAttribute === 'id') {
      const success = await this._deleteItem(toDynamoItem({ id: filterValue }));
      return success ? 1 : 0;
    }
    const ids = await this._getIDs(filterAttribute, filterValue);
    const successes = await Promise.all(ids.map((id) => this._deleteItem(toDynamoItem({ id }))));
    return successes.filter((success) => success).length;
  }

  protected override async internalDestroy() {
    await this._ddb.deleteTable(this._tableName);
    await this._ddb.deleteTable(indexTable(this._tableName)).catch(ignore);
  }

  /** @internal */ private async _atomicPutUniques(
    id: DDBValue,
    item: DDBItem,
    uniqueKeys: (string & keyof T)[],
    fn: () => Promise<void>,
  ): Promise<void> {
    if (!uniqueKeys.length) {
      await fn();
      return;
    }

    const indexTableName = indexTable(this._tableName);
    const successes: string[] = [];
    try {
      await runAll(uniqueKeys, successes, (attr) =>
        this._ddb
          .putItem(indexTableName, { ix: toDynamoKey(attr, item[attr]!), id }, 'ix')
          .catch(
            wrapError(ConditionalCheckFailedException, () => new DuplicateError(this.name, attr)),
          ),
      );
      await fn();
    } catch (err) {
      await this._ddb
        .batchDeleteItems(
          indexTableName,
          successes.map((attr) => ({ ix: toDynamoKey(attr, item[attr]!) })),
        )
        .catch(ignore); // best effort to reset state, but ignore errors here
      throw err;
    }
  }

  /** @internal */ private async _putItem(item: DDBItem): Promise<void> {
    return this._atomicPutUniques(item['id']!, item, this._uniqueKeys, () =>
      this._ddb
        .putItem(this._tableName, item, 'id')
        .catch(
          wrapError(ConditionalCheckFailedException, () => new DuplicateError(this.name, 'id')),
        ),
    );
  }

  /** @internal */ private async _putItems(items: DDBItem[]): Promise<void> {
    await Promise.all(items.map((item) => this._putItem(item)));
  }

  /** @internal */ private async _updateItem(
    key: DDBItem,
    update: DDBItem,
    condition?: DDBItem,
  ): Promise<void> {
    const updatedUnique = this._uniqueKeys.filter((a) =>
      Object.prototype.hasOwnProperty.call(update, a),
    );

    if (!updatedUnique.length) {
      await this._ddb.updateItem(this._tableName, key, update, condition);
      return;
    }
    const old = await this._ddb.getItem(this._tableName, key, updatedUnique);
    if (!old) {
      throw new AWSError(400, ConditionalCheckFailedException, 'could not find item to update');
    }
    const changedAttrs = updatedUnique.filter((a) => (old[a] as any).B !== (update[a] as any).B);
    await this._atomicPutUniques(key['id']!, update, changedAttrs, () =>
      this._ddb.updateItem(this._tableName, key, update, {
        ...old,
        ...condition,
      }),
    );
    await this._ddb.batchDeleteItems(
      indexTable(this._tableName),
      changedAttrs.map((attr) => ({ ix: toDynamoKey(attr, old[attr]!) })),
    );
  }

  /** @internal */ private async _deleteItem(key: DDBItem): Promise<boolean> {
    try {
      if (!this._uniqueKeys.length) {
        await this._ddb.deleteItem(this._tableName, key);
      } else {
        const item = await this._ddb._deleteAndReturnItem(this._tableName, key);
        await this._ddb.batchDeleteItems(
          indexTable(this._tableName),
          this._uniqueKeys.map((attr) => ({
            ix: toDynamoKey(attr, item[attr]!),
          })),
        );
      }
      return true;
    } catch (err) {
      if (AWSError.isType(err, ConditionalCheckFailedException)) {
        return false;
      }
      throw err;
    }
  }
}
