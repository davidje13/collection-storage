import {
  DDB,
  DDBItem,
  DDBValue,
  escapeName,
  TransactWrite,
} from './api/DDB';
import type { IDable } from '../interfaces/IDable';
import BaseCollection from '../interfaces/BaseCollection';
import type { DBKeys } from '../interfaces/DB';
import { serialiseValueBin, deserialiseValueBin } from '../helpers/serialiser';

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

function fromDynamoItem(value: DDBItem): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  Object.keys(value).forEach((key) => {
    result[key] = fromDynamoValue(value[key]);
  });
  return result;
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

async function configureTable(
  ddb: DDB,
  tableName: string,
  nonuniqueKeys: string[],
  uniqueKeys: string[],
): Promise<void> {
  const indexTableName = indexTable(tableName);
  const [created] = await Promise.all<boolean, unknown>([
    ddb.createTable(
      tableName,
      [{ attributeName: 'id', attributeType: 'B', keyType: 'HASH' }],
      nonuniqueKeys.map((attr) => ({
        indexName: escapeName(attr),
        keySchema: [{ attributeName: attr, attributeType: 'B', keyType: 'HASH' }],
      })),
      true,
    ),
    uniqueKeys.length ? ddb.createTable(
      indexTableName,
      [{ attributeName: 'ix', attributeType: 'B', keyType: 'HASH' }],
      [],
      true,
    ) : ddb.deleteTable(indexTableName).catch(() => {}),
  ]);

  if (created || !uniqueKeys.length) {
    return;
  }

  // table already existed; might need to migrate old data for unique indices
  const info = await ddb.getItem(indexTableName, { ix: INDEX_META_KEY }, ['meta']);
  const newKeys = new Set(uniqueKeys);
  const oldKeys: string[] = [];
  if (info && isDynamoStringSet(info.meta)) {
    oldKeys.push(...info.meta.SS.filter((item) => !newKeys.delete(item)));
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
  await ddb.putItem(indexTableName, { ix: INDEX_META_KEY, meta: { SS: uniqueKeys } });
}

export default class DynamoCollection<T extends IDable> extends BaseCollection<T> {
  private readonly uniqueKeys: (keyof T & string)[] = [];

  public constructor(
    private readonly ddb: DDB,
    private readonly tableName: string,
    keys: DBKeys<T> = {},
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

    this.initAsync(configureTable(ddb, tableName, nonuniqueKeys, this.uniqueKeys));
  }

  protected async internalAdd(value: T): Promise<void> {
    if (!await this.putItem(toDynamoItem(value as any))) {
      throw new Error('duplicate');
    }
  }

  protected async internalUpsert(
    id: T['id'],
    update: Partial<T>,
  ): Promise<void> {
    const item = toDynamoItem({ id, ...update });
    const { id: itemId, ...itemNoKey } = item;
    const key = { id: itemId };
    /* eslint-disable no-await-in-loop */ // intentionally serial
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (await this.updateItem(key, itemNoKey, key)) {
        return;
      }
      if (await this.putItem(item)) {
        return;
      }
    }
    /* eslint-enable no-await-in-loop */
    throw new Error('Failed to upsert item');
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
      );
    } else {
      const items = await this.internalGetAll(searchAttribute, searchValue, ['id']);
      await Promise.all(items.map(({ id }) => this.updateItem(
        toDynamoItem({ id }),
        toDynamoItem(update),
        toDynamoItem({ [searchAttribute]: searchValue }),
      )));
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
    let ddbItem: DDBItem | null;
    if (searchAttribute === 'id') {
      ddbItem = await this.ddb.getItem(
        this.tableName,
        toDynamoItem({ id: searchValue }),
        returnAttributes,
      );
    } else if (this.isIndexUnique(searchAttribute)) {
      ddbItem = await this.ddb.getItem(
        indexTable(this.tableName),
        { ix: toDynamoKey(searchAttribute, toDynamoValue(searchValue)) },
        ['id'],
      );
      if (ddbItem) {
        // TODO: only call this if extra cols are needed
        // also can fill in search column from input if needed
        ddbItem = await this.ddb.getItem(
          this.tableName,
          { id: ddbItem.id },
          returnAttributes,
        );
      }
    } else {
      [ddbItem] = (await this.ddb.getItemsBySecondaryKey(
        this.tableName,
        escapeName(searchAttribute),
        toDynamoItem({ [searchAttribute]: searchValue }),
        returnAttributes,
        true,
      ));
    }
    if (!ddbItem) {
      return null;
    }
    return fromDynamoItem(ddbItem) as Pick<T, F[-1]>;
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
    if (this.isIndexUnique(searchAttribute)) {
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

  private async putItem(item: DDBItem): Promise<boolean> {
    if (!this.uniqueKeys.length) {
      return this.ddb.putItem(this.tableName, item, 'id');
    }
    return this.ddb.transactWriteItems([
      ...this.uniqueKeys.map((attr): TransactWrite => ({
        type: 'put',
        tableName: indexTable(this.tableName),
        item: { ix: toDynamoKey(attr, item[attr]), id: item.id },
        unique: 'ix',
      })),
      {
        type: 'put',
        tableName: this.tableName,
        item,
        unique: 'id',
      },
    ]);
  }

  private async updateItem(key: DDBItem, update: DDBItem, condition?: DDBItem): Promise<boolean> {
    const updatedUnique = this.uniqueKeys.filter((a) => Object.hasOwnProperty.call(update, a));
    if (!updatedUnique.length) {
      return this.ddb.updateItem(this.tableName, key, update, condition);
    }
    const old = await this.ddb.getItem(this.tableName, key, updatedUnique);
    if (!old) {
      return false;
    }
    const changedAttrs = updatedUnique.filter((a) => (old[a] as any).B !== (update[a] as any).B);
    if (!changedAttrs.length) {
      return this.ddb.updateItem(this.tableName, key, update, { ...old, ...condition });
    }
    const success = await this.ddb.transactWriteItems([
      ...changedAttrs.map((attr): TransactWrite => ({
        type: 'put',
        tableName: indexTable(this.tableName),
        item: { ix: toDynamoKey(attr, update[attr]), id: key.id },
        unique: 'ix',
      })),
      {
        type: 'update',
        tableName: this.tableName,
        key,
        update,
        condition: { ...old, ...condition },
      },
    ]);
    if (!success) {
      return false;
    }
    await Promise.all(changedAttrs.map((attr) => this.ddb.deleteItem(
      indexTable(this.tableName),
      { ix: toDynamoKey(attr, old[attr]) },
    )));
    return true;
  }

  private async deleteItem(key: DDBItem): Promise<boolean> {
    if (!this.uniqueKeys.length) {
      return this.ddb.deleteItem(this.tableName, key);
    }
    const item = await this.ddb.deleteAndReturnItem(this.tableName, key);
    if (!item) {
      return false;
    }
    await this.ddb.batchDeleteItems(
      indexTable(this.tableName),
      this.uniqueKeys.map((attr) => ({ ix: toDynamoKey(attr, item[attr]) })),
    );
    return true;
  }
}
