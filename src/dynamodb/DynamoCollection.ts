import {
  DDB,
  DDBItem,
  DDBValue,
  escapeName,
  DDBProvisionedThroughput,
} from './api/DDB';
import AWSError from './api/AWSError';
import type { IDable } from '../interfaces/IDable';
import BaseCollection from '../interfaces/BaseCollection';
import type { DBKeys } from '../interfaces/DB';
import { serialiseValueBin, deserialiseValueBin } from '../helpers/serialiser';

const ConditionalCheckFailedException = 'ConditionalCheckFailedException';

async function runAll<T>(
  values: T[],
  successesOut: T[],
  fn: (value: T) => Promise<void>,
): Promise<void> {
  const results = await Promise.allSettled(values.map(async (value) => {
    await fn(value);
    successesOut.push(value);
  }));
  const failures = results.filter((s) => s.status === 'rejected') as PromiseRejectedResult[];
  if (failures.length) {
    throw failures[0];
  }
}

function wrapError(type: string, message: string): (e: unknown) => void {
  return (e): void => {
    throw AWSError.isType(e, type) ? new Error(message) : e;
  };
}

function handleError<T>(
  type: string,
  fn: () => Promise<T> | T,
): (e: unknown) => Promise<T> | T {
  return (e): (Promise<T> | T) => {
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
  const result: DDBItem = {};
  Object.keys(value).forEach((key) => {
    result[key] = toDynamoValue(value[key]);
  });
  return result;
}

function isDynamoBinary(value: DDBValue): value is { B: string } {
  return Object.hasOwnProperty.call(value, 'B');
}

function isDynamoStringSet(value: DDBValue): value is { SS: string[] } {
  return Object.hasOwnProperty.call(value, 'SS');
}

function fromDynamoValue(value: DDBValue): unknown {
  if (isDynamoBinary(value)) {
    return deserialiseValueBin(Buffer.from(value.B, 'base64'));
  }
  throw new Error('unexpected value type from DDB');
}

function fromDynamoItem<T = Record<string, unknown>>(value: DDBItem): T;
function fromDynamoItem<T = Record<string, unknown>>(value: DDBItem | null | undefined): T | null;

function fromDynamoItem<T = Record<string, unknown>>(value: DDBItem | null | undefined): T | null {
  if (!value) {
    return null;
  }
  const result: Record<string, unknown> = {};
  Object.keys(value).forEach((key) => {
    result[key] = fromDynamoValue(value[key]);
  });
  return result as T;
}

function toDynamoKey(attr: string, value: DDBValue): DDBValue {
  if (!isDynamoBinary(value)) {
    throw new Error('unexpected value type from DDB');
  }
  return {
    B: Buffer.concat([
      Buffer.from(`${attr}:`, 'utf8'),
      Buffer.from(value.B, 'base64'),
    ]).toString('base64'),
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
  keys.forEach((attr) => {
    const cur = throughputFn?.(attr);
    if (cur) {
      hasThroughput = true;
      totalThroughput.read += cur.read;
      totalThroughput.write += cur.write;
    }
  });
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

  const [created] = await Promise.all<boolean, unknown>([
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
    uniqueKeys.length ? ddb.upsertTable(
      indexTableName,
      [{ attributeName: 'ix', attributeType: 'B', keyType: 'HASH' }],
      [],
      true,
      toDDBThroughput(getCombinedThroughput(uniqueKeys, throughputFn)),
    ) : ddb.deleteTable(indexTableName).catch(ignore),
  ]);

  if (created || !uniqueKeys.length) {
    return;
  }

  // table already existed; might need to migrate old data for unique indices
  const info = await ddb.getItem(indexTableName, { ix: INDEX_META_KEY }, ['unique']);
  const newKeys = new Set(uniqueKeys);
  const oldKeys: string[] = [];
  if (info && isDynamoStringSet(info.unique)) {
    oldKeys.push(...info.unique.SS.filter((item) => !newKeys.delete(item)));
  }
  if (newKeys.size) {
    // we have new keys which must be populated
    const attrs = [...newKeys];
    await ddb.getAllItems(tableName, ['id', ...attrs]).batched(async (items) => {
      const indexItems: DDBItem[] = [];
      items.forEach((item) => attrs.forEach((attr) => {
        indexItems.push({ ix: toDynamoKey(attr, item[attr]), id: item.id });
      }));
      return ddb.batchPutItems(indexTableName, indexItems);
    });
  } else if (!oldKeys.length) {
    return; // no change
  }
  // do not delete old items; storing them is relatively
  // cheap compared to scanning and deleting them

  // update stored info about indices
  await ddb.putItem(indexTableName, { ix: INDEX_META_KEY, unique: { SS: uniqueKeys } });
}

export default class DynamoCollection<T extends IDable> extends BaseCollection<T> {
  private readonly uniqueKeys: (keyof T & string)[] = [];

  public constructor(
    private readonly ddb: DDB,
    private readonly tableName: string,
    keys: DBKeys<T> = {},
    throughputFn?: CollectionThroughputFn,
  ) {
    super(keys);

    const nonuniqueKeys: (keyof T & string)[] = [];
    Object.entries(keys).forEach(([key, options]) => {
      if (options?.unique) {
        this.uniqueKeys.push(key as (keyof T & string));
      } else {
        nonuniqueKeys.push(key as (keyof T & string));
      }
    });

    this.initAsync(configureTable(
      ddb,
      tableName,
      nonuniqueKeys,
      this.uniqueKeys,
      throughputFn,
    ));
  }

  get internalTableName(): string {
    return this.tableName;
  }

  get internalIndexTableName(): string {
    return indexTable(this.tableName);
  }

  protected internalAdd(value: T): Promise<void> {
    return this.putItem(toDynamoItem(value as any));
  }

  protected internalUpsert(
    id: T['id'],
    update: Partial<T>,
  ): Promise<void> {
    const item = toDynamoItem({ id, ...update });
    const { id: itemId, ...itemNoKey } = item;
    const key = { id: itemId };

    // optimistically try to update
    return this.updateItem(key, itemNoKey, key).catch(handleError(
      ConditionalCheckFailedException,

      // if that fails due to the item not existing, try creating it
      () => this.putItem(item).catch(handleError(
        'duplicate id',

        // it that fails due to the item existing, the item was probably
        // created in the gap between calls; update it
        () => this.updateItem(key, itemNoKey, key).catch(wrapError(
          ConditionalCheckFailedException,

          // if it fails again, give up
          'Failed to upsert item',
        )),
      )),
    ));
  }

  protected async internalUpdate<K extends keyof T & string>(
    searchAttribute: K,
    searchValue: T[K],
    { id: _, ...update }: Partial<T>,
  ): Promise<void> {
    if (searchAttribute === 'id') {
      await this.updateItem(
        toDynamoItem({ id: searchValue }),
        toDynamoItem(update),
      ).catch(handleError(ConditionalCheckFailedException, ignore));
    } else {
      const items = await this.internalGetAll(searchAttribute, searchValue, ['id']);
      await Promise.all(items.map(({ id }) => this.updateItem(
        toDynamoItem({ id }),
        toDynamoItem(update),
        toDynamoItem({ [searchAttribute]: searchValue }),
      ).catch(handleError(ConditionalCheckFailedException, ignore))));
    }
  }

  protected async internalGet<
    K extends keyof T & string,
    F extends readonly (keyof T & string)[]
  >(
    searchAttribute: K,
    searchValue: T[K],
    returnAttributes?: F,
  ): Promise<Readonly<Pick<T, F[-1]>> | null> {
    if (searchAttribute === 'id') {
      return fromDynamoItem<Pick<T, F[-1]>>(await this.ddb.getItem(
        this.tableName,
        toDynamoItem({ id: searchValue }),
        returnAttributes,
      ));
    }

    if (!this.indices.isUniqueIndex(searchAttribute)) {
      const ddbItems = await this.ddb.getItemsBySecondaryKey(
        this.tableName,
        escapeName(searchAttribute),
        toDynamoItem({ [searchAttribute]: searchValue }),
        returnAttributes,
        true,
      );
      return fromDynamoItem<Pick<T, F[-1]>>(ddbItems[0]);
    }

    const ddbSearchValue = toDynamoValue(searchValue);
    const key = await this.ddb.getItem(
      indexTable(this.tableName),
      { ix: toDynamoKey(searchAttribute, ddbSearchValue) },
      ['id'],
    );
    if (!key) {
      return null;
    }
    if (!returnAttributes) {
      return fromDynamoItem<Pick<T, F[-1]>>(await this.ddb.getItem(this.tableName, key));
    }
    const ddbItem: DDBItem = {};
    const filteredReturn = new Set(returnAttributes);
    if (filteredReturn.delete('id')) {
      Object.assign(ddbItem, key);
    }
    if (filteredReturn.delete(searchAttribute)) {
      ddbItem[searchAttribute] = ddbSearchValue;
    }
    if (filteredReturn.size) {
      const primaryItem = await this.ddb.getItem(this.tableName, key, [...filteredReturn]);
      if (!primaryItem) {
        // index and main table are out of sync;
        // assume main table is correct and item does not exist
        return null;
      }
      Object.assign(ddbItem, primaryItem);
    }
    return fromDynamoItem<Pick<T, F[-1]>>(ddbItem);
  }

  protected async internalGetAll<
    K extends keyof T & string,
    F extends readonly (keyof T & string)[]
  >(
    searchAttribute?: K,
    searchValue?: T[K],
    returnAttributes?: F,
  ): Promise<Readonly<Pick<T, F[-1]>>[]> {
    if (!searchAttribute) {
      const items = await this.ddb.getAllItems(this.tableName, returnAttributes).all();
      return items.map(fromDynamoItem) as Pick<T, F[-1]>[];
    }
    if (this.indices.isUniqueIndex(searchAttribute)) {
      const item = await this.internalGet(searchAttribute, searchValue!, returnAttributes);
      return item ? [item] : [];
    }
    const items = await this.ddb.getItemsBySecondaryKey(
      this.tableName,
      escapeName(searchAttribute),
      toDynamoItem({ [searchAttribute]: searchValue }),
      returnAttributes,
      false,
    );
    return items.map(fromDynamoItem) as Pick<T, F[-1]>[];
  }

  protected async internalRemove<K extends keyof T & string>(
    searchAttribute: K,
    searchValue: T[K],
  ): Promise<number> {
    if (searchAttribute === 'id') {
      const success = await this.deleteItem(toDynamoItem({ id: searchValue }));
      return success ? 1 : 0;
    }
    const items = await this.internalGetAll(searchAttribute, searchValue, ['id']);
    const successes = await Promise.all(items.map(({ id }) => this.deleteItem(
      toDynamoItem({ id }),
    )));
    return successes.filter((success) => success).length;
  }

  private async atomicPutUniques(
    id: DDBValue,
    item: DDBItem,
    uniqueKeys: (keyof T & string)[],
    fn: () => Promise<void>,
  ): Promise<void> {
    if (!uniqueKeys.length) {
      await fn();
      return;
    }

    const indexTableName = indexTable(this.tableName);
    const successes: string[] = [];
    try {
      await runAll(uniqueKeys, successes, (attr) => this.ddb.putItem(
        indexTableName,
        { ix: toDynamoKey(attr, item[attr]), id },
        'ix',
      ).catch(wrapError(ConditionalCheckFailedException, `duplicate ${attr}`)));
      await fn();
    } catch (e) {
      await this.ddb.batchDeleteItems(
        indexTableName,
        successes.map((attr) => ({ ix: toDynamoKey(attr, item[attr]) })),
      ).catch(ignore); // best effort to reset state, but ignore errors here
      throw e;
    }
  }

  private async putItem(item: DDBItem): Promise<void> {
    return this.atomicPutUniques(
      item.id,
      item,
      this.uniqueKeys,
      () => this.ddb.putItem(
        this.tableName,
        item,
        'id',
      ).catch(wrapError(ConditionalCheckFailedException, 'duplicate id')),
    );
  }

  private async updateItem(key: DDBItem, update: DDBItem, condition?: DDBItem): Promise<void> {
    const updatedUnique = this.uniqueKeys.filter((a) => Object.hasOwnProperty.call(update, a));
    if (!updatedUnique.length) {
      await this.ddb.updateItem(this.tableName, key, update, condition);
      return;
    }
    const old = await this.ddb.getItem(this.tableName, key, updatedUnique);
    if (!old) {
      throw new AWSError(400, ConditionalCheckFailedException, 'could not find item to update');
    }
    const changedAttrs = updatedUnique.filter((a) => (old[a] as any).B !== (update[a] as any).B);
    await this.atomicPutUniques(
      key.id,
      update,
      changedAttrs,
      () => this.ddb.updateItem(this.tableName, key, update, { ...old, ...condition }),
    );
    await this.ddb.batchDeleteItems(
      indexTable(this.tableName),
      changedAttrs.map((attr) => ({ ix: toDynamoKey(attr, old[attr]) })),
    );
  }

  private async deleteItem(key: DDBItem): Promise<boolean> {
    try {
      if (!this.uniqueKeys.length) {
        await this.ddb.deleteItem(this.tableName, key);
      } else {
        const item = await this.ddb.deleteAndReturnItem(this.tableName, key);
        await this.ddb.batchDeleteItems(
          indexTable(this.tableName),
          this.uniqueKeys.map((attr) => ({ ix: toDynamoKey(attr, item[attr]) })),
        );
      }
      return true;
    } catch (e) {
      if (AWSError.isType(e, ConditionalCheckFailedException)) {
        return false;
      }
      throw e;
    }
  }
}
