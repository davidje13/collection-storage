import type { IDable } from '../interfaces/IDable.mts';
import { BaseCollection } from '../interfaces/BaseCollection.mts';
import type { CollectionOptions } from '../interfaces/CollectionOptions.mts';
import {
  serialiseValue,
  serialiseRecord,
  deserialiseRecord,
  type Serialised,
  partialDeserialiseRecord,
} from '../helpers/serialiser.mts';

function sleep(millis: number): Promise<void> | void {
  if (!millis) {
    return undefined;
  }

  // Simulate data access delays to ensure non-flakey e2e tests, etc.
  return new Promise((resolve): any => setTimeout(resolve, millis));
}

interface CollectionBackingData<T> {
  readonly _data: Map<string, Serialised<T>>;
  readonly _customIndexData: Map<string & keyof T, Map<string | undefined, Set<string>>>;
  readonly _uniqueIndexDataPtrs: [string & keyof T, Map<string | undefined, Set<string>>][];
}

export type DBBackingData = Map<string, CollectionBackingData<any>>;

export class MemoryCollection<T extends IDable> extends BaseCollection<T> {
  /** @internal */ private readonly _backing: CollectionBackingData<T>;
  /** @internal */ private readonly _simulatedLatency: number;

  /** @internal */ constructor(
    options: CollectionOptions<T>,
    dbBackingData: DBBackingData,
    simulatedLatency = 0,
  ) {
    super(options);
    let backingData = dbBackingData.get(options.name);
    if (!backingData) {
      const customIndexData = new Map(this.indices.getCustomIndices().map((k) => [k, new Map()]));
      backingData = {
        _data: new Map(),
        _customIndexData: customIndexData,
        _uniqueIndexDataPtrs: this.indices
          .getUniqueIndices()
          .filter((k) => k !== 'id')
          .map((k) => [k, customIndexData.get(k)!]),
      };
      dbBackingData.set(options.name, backingData);
    } else {
      // migrate existing indices
      const indices = backingData._customIndexData;
      const newIndices = new Set<string>(this.indices.getCustomIndices());
      for (const [attr] of indices) {
        if (!this.indices.isIndex(attr)) {
          indices.delete(attr);
        } else {
          newIndices.delete(attr);
        }
      }
      for (const attr of newIndices) {
        const index = new Map<string, Set<string>>();
        for (const sRecord of backingData._data.values()) {
          const v = sRecord.get(attr);
          if (v === undefined) {
            continue;
          }
          let o = index.get(v);
          if (!o) {
            o = new Set<string>();
            index.set(v, o);
          }
          o.add(sRecord.get('id')!);
        }
        indices.set(attr, index);
      }

      // migrate existing uniqueness constraints
      const uniqueIndices = backingData._uniqueIndexDataPtrs;
      const newUniqueIndices = new Set<string>(this.indices.getUniqueIndices());
      newUniqueIndices.delete('id');
      let del = 0;
      for (let i = 0; i < uniqueIndices.length; ++i) {
        const attr = uniqueIndices[i]![0];
        if (!this.indices.isUniqueIndex(attr)) {
          ++del;
        } else {
          newUniqueIndices.delete(attr);
          if (del) {
            uniqueIndices[i - del] = uniqueIndices[i]!;
          }
        }
      }
      uniqueIndices.length -= del;
      for (const attr of newUniqueIndices) {
        const index = indices.get(attr)!;
        for (const records of index.values()) {
          if (records.size > 1) {
            throw new Error(`Existing records contain duplicate ${this.name}.${attr}`);
          }
        }
        uniqueIndices.push([attr, index]);
      }
    }
    this._backing = backingData;
    this._simulatedLatency = simulatedLatency;
  }

  /** @internal */ protected override preAct() {
    return sleep(this._simulatedLatency);
  }

  protected override internalAddBatch(records: T[]) {
    for (const record of records) {
      const sRecord = serialiseRecord(record);
      this._checkDuplicates(sRecord, true);
      this._backing._data.set(sRecord.get('id')!, sRecord);
      this._populateIndices(sRecord);
    }
    return Promise.resolve();
  }

  /** @internal */ protected override internalUpsert(id: T['id'], delta: Partial<T>) {
    if (this._backing._data.has(serialiseValue(id))) {
      return this.internalUpdate('id', id, delta);
    }
    const sRecord = serialiseRecord({ id, ...delta });
    this._checkDuplicates(sRecord, true);
    this._backing._data.set(sRecord.get('id')!, sRecord);
    this._populateIndices(sRecord);
    return Promise.resolve();
  }

  protected override async internalUpdate<K extends string & keyof T>(
    filterAttribute: K,
    filterValue: T[K],
    delta: Partial<T>,
  ): Promise<void> {
    const updates: { _oldSerialised: Serialised<T>; _newSerialised: Serialised<T> }[] = [];
    for (const sId of this._getSerialisedIds(filterAttribute, filterValue).keys()) {
      const oldSerialised = this._backing._data.get(sId)!;
      const oldRecord = deserialiseRecord(oldSerialised);
      const newRecord = { ...oldRecord, ...delta };
      if (newRecord.id !== oldRecord.id) {
        throw new Error('Cannot update ID');
      }
      updates.push({ _oldSerialised: oldSerialised, _newSerialised: serialiseRecord(newRecord) });
    }

    updates.forEach(({ _oldSerialised }) => this._removeIndices(_oldSerialised));
    try {
      updates.forEach(({ _newSerialised }) => this._checkDuplicates(_newSerialised, false));
    } catch (e) {
      updates.forEach(({ _oldSerialised }) => this._populateIndices(_oldSerialised));
      throw e;
    }
    for (const { _newSerialised } of updates) {
      this._backing._data.set(_newSerialised.get('id')!, _newSerialised);
      this._populateIndices(_newSerialised);
    }
  }

  protected override async *internalGetAll<
    K extends string & keyof T,
    F extends readonly (string & keyof T)[],
  >(filterAttribute: K | undefined, filterValue: T[K] | undefined, returnAttributes?: F) {
    for (const sId of this._getSerialisedIds(filterAttribute, filterValue).keys()) {
      yield partialDeserialiseRecord(this._backing._data.get(sId)!, returnAttributes);
    }
  }

  /** @internal */ protected override async internalExists<K extends string & keyof T>(
    filterAttribute: K | undefined,
    filterValue: T[K] | undefined,
  ) {
    return this._getSerialisedIds(filterAttribute, filterValue).size > 0;
  }

  /** @internal */ protected override async internalCount<K extends string & keyof T>(
    filterAttribute: K | undefined,
    filterValue: T[K] | undefined,
  ) {
    return this._getSerialisedIds(filterAttribute, filterValue).size;
  }

  protected override async internalRemove<K extends string & keyof T>(
    filterAttribute: K | undefined,
    filterValue: T[K] | undefined,
  ) {
    const sIds = this._getSerialisedIds(filterAttribute, filterValue);
    const count = sIds.size;
    for (const sId of sIds.keys()) {
      const oldSerialised = this._backing._data.get(sId)!;
      this._removeIndices(oldSerialised);
      this._backing._data.delete(sId);
    }

    return count;
  }

  protected override internalDestroy() {
    this._backing._data.clear();
    this._backing._customIndexData.clear();
    this._backing._uniqueIndexDataPtrs.length = 0;
  }

  /** @internal */ private _getSerialisedIds<K extends string & keyof T>(
    filterAttribute: K | undefined,
    filterValue: T[K] | undefined,
  ): Map<string, unknown> | Set<string> {
    if (filterAttribute === undefined) {
      return this._backing._data;
    }
    const sKey = serialiseValue(filterValue);
    if (filterAttribute === 'id') {
      return this._backing._data.has(sKey) ? new Set([sKey]) : VOID_SET;
    }
    const index = this._backing._customIndexData.get(filterAttribute);
    if (!index) {
      throw new Error(`Requested key ${filterAttribute} not indexed`);
    }
    return index.get(sKey) ?? VOID_SET;
  }

  /** @internal */ private _checkDuplicates(
    serialisedValue: Serialised<T>,
    checkId: boolean,
  ): void {
    if (checkId && this._backing._data.has(serialisedValue.get('id')!)) {
      throw new Error(`duplicate ${this.name}.id`);
    }
    for (const [attr, index] of this._backing._uniqueIndexDataPtrs) {
      if (index.has(serialisedValue.get(attr)!)) {
        throw new Error(`duplicate ${this.name}.${attr}`);
      }
    }
  }

  /** @internal */ private _populateIndices(serialisedValue: Serialised<T>): void {
    const id = serialisedValue.get('id')!;
    this._backing._customIndexData.forEach((index, key) => {
      const v = serialisedValue.get(key);
      let o = index.get(v);
      if (!o) {
        o = new Set<string>();
        index.set(v, o);
      }
      o.add(id);
    });
  }

  /** @internal */ private _removeIndices(serialisedValue: Serialised<T>): void {
    const id = serialisedValue.get('id')!;
    this._backing._customIndexData.forEach((index, key) => {
      const v = serialisedValue.get(key);
      const o = index.get(v)!;
      o.delete(id);
      if (!o.size) {
        index.delete(v);
      }
    });
  }
}

const VOID_SET = new Set<never>();
