import type { IDable } from '../interfaces/IDable';
import BaseCollection from '../interfaces/BaseCollection';
import type { DBKeys } from '../interfaces/DB';
import type { StateRef } from '../interfaces/BaseDB';
import {
  serialiseValue,
  serialiseRecord,
  deserialiseRecord,
  Serialised,
  partialDeserialiseRecord,
} from '../helpers/serialiser';

function sleep(millis: number): Promise<void> | void {
  if (!millis) {
    return undefined;
  }

  // Simulate data access delays to ensure non-flakey e2e tests, etc.
  return new Promise((resolve): any => setTimeout(resolve, millis));
}

export default class MemoryCollection<T extends IDable> extends BaseCollection<T> {
  private readonly data = new Map<string, Serialised<T>>();

  private readonly customIndexData: Map<string & keyof T, Map<string, Set<string>>>;

  private readonly uniqueIndexDataPtrs: [string & keyof T, Map<string, Set<string>>][];

  public constructor(
    keys: DBKeys<T> = {},
    private readonly simulatedLatency = 0,
    private readonly stateRef: StateRef = { closed: false },
  ) {
    super(keys);

    this.customIndexData = new Map(this.indices.getCustomIndices().map((k) => ([k, new Map()])));

    this.uniqueIndexDataPtrs = this.indices.getUniqueIndices()
      .filter((k) => (k !== 'id'))
      .map((k) => ([k, this.customIndexData.get(k)!]));
  }

  protected preAct(): Promise<void> | void {
    if (this.stateRef.closed) {
      throw new Error('Connection closed');
    }
    return sleep(this.simulatedLatency);
  }

  protected async internalAdd(value: T): Promise<void> {
    const serialised = serialiseRecord(value);
    this.internalCheckDuplicates(serialised, true);
    this.data.set(serialised.get('id')!, serialised);
    this.internalPopulateIndices(serialised);
  }

  protected internalUpsert(
    id: T['id'],
    update: Partial<T>,
  ): Promise<void> {
    if (this.data.has(serialiseValue(id))) {
      return this.internalUpdate('id', id, update);
    }
    return this.internalAdd({ id, ...update } as T);
  }

  protected async internalUpdate<K extends string & keyof T>(
    searchAttribute: K,
    searchValue: T[K],
    update: Partial<T>,
  ): Promise<void> {
    const sIds = this.internalGetSerialisedIds(searchAttribute, searchValue);

    const updates = sIds.map((sId) => {
      const oldSerialised = this.data.get(sId)!;
      const oldValue = deserialiseRecord(oldSerialised);
      const newValue = { ...oldValue, ...update };
      if (newValue.id !== oldValue.id) {
        throw new Error('Cannot update ID');
      }
      const newSerialised = serialiseRecord(newValue);
      return { oldSerialised, newSerialised };
    });

    updates.forEach(({ oldSerialised }) => this.internalRemoveIndices(oldSerialised));
    try {
      updates.forEach(({ newSerialised }) => this.internalCheckDuplicates(newSerialised, false));
    } catch (e) {
      updates.forEach(({ oldSerialised }) => this.internalPopulateIndices(oldSerialised));
      throw e;
    }
    updates.forEach(({ newSerialised }) => {
      this.data.set(newSerialised.get('id')!, newSerialised);
      this.internalPopulateIndices(newSerialised);
    });
  }

  protected async internalGetAll<
    K extends string & keyof T,
    F extends readonly (string & keyof T)[]
  >(
    searchAttribute?: K,
    searchValue?: T[K],
    returnAttributes?: F,
  ): Promise<Readonly<Pick<T, F[-1]>>[]> {
    let sIds: string[];
    if (searchAttribute) {
      sIds = this.internalGetSerialisedIds(searchAttribute, searchValue!);
    } else {
      sIds = [...this.data.keys()];
    }
    return sIds.map((sId) => partialDeserialiseRecord(this.data.get(sId)!, returnAttributes));
  }

  protected async internalRemove<K extends string & keyof T>(
    searchAttribute: K,
    searchValue: T[K],
  ): Promise<number> {
    const sIds = this.internalGetSerialisedIds(searchAttribute, searchValue);
    sIds.forEach((sId) => {
      const oldSerialised = this.data.get(sId)!;
      this.internalRemoveIndices(oldSerialised);
      this.data.delete(sId);
    });

    return sIds.length;
  }

  private internalGetSerialisedIds<K extends string & keyof T>(
    searchAttribute: K,
    searchValue: T[K],
  ): string[] {
    const sKey = serialiseValue(searchValue);
    if (searchAttribute === 'id') {
      return this.data.has(sKey) ? [sKey] : [];
    }
    const index = this.customIndexData.get(searchAttribute);
    if (!index) {
      throw new Error(`Requested key ${searchAttribute} not indexed`);
    }
    const sIds = index.get(sKey);
    return sIds ? [...sIds] : []; // convert set to array
  }

  private internalCheckDuplicates(serialisedValue: Serialised<T>, checkId: boolean): void {
    if (checkId && this.data.has(serialisedValue.get('id')!)) {
      throw new Error('duplicate');
    }
    this.uniqueIndexDataPtrs.forEach(([key, index]) => {
      if (index.has(serialisedValue.get(key)!)) {
        throw new Error('duplicate');
      }
    });
  }

  private internalPopulateIndices(serialisedValue: Serialised<T>): void {
    const id = serialisedValue.get('id')!;
    this.customIndexData.forEach((index, key) => {
      const v = serialisedValue.get(key)!;
      let o = index.get(v);
      if (!o) {
        o = new Set<string>();
        index.set(v, o);
      }
      o.add(id);
    });
  }

  private internalRemoveIndices(serialisedValue: Serialised<T>): void {
    const id = serialisedValue.get('id')!;
    this.customIndexData.forEach((index, key) => {
      const v = serialisedValue.get(key)!;
      const o = index.get(v)!;
      o.delete(id);
      if (!o.size) {
        index.delete(v);
      }
    });
  }
}
