import type { IDable } from '../interfaces/IDable';
import BaseCollection from '../interfaces/BaseCollection';
import type { DBKeys } from '../interfaces/DB';
import {
  serialiseValue,
  serialiseRecord,
  deserialiseRecord,
} from '../helpers/serialiser';

function sleep(millis: number): Promise<void> | void {
  if (!millis) {
    return undefined;
  }

  // Simulate data access delays to ensure non-flakey e2e tests, etc.
  return new Promise((resolve): any => setTimeout(resolve, millis));
}

function applyFilter<T, F extends readonly (keyof T)[]>(
  data: T,
  fields?: F,
): Pick<T, F[-1]> {
  if (!fields) {
    return data;
  }
  const result: Pick<T, F[-1]> = {} as any;
  fields.forEach((field) => {
    result[field] = data[field];
  });
  return result;
}

interface State {
  closed: boolean;
}

export default class MemoryCollection<T extends IDable> extends BaseCollection<T> {
  private readonly data: Map<string, Record<string, string>>;

  private readonly indices: Partial<Record<keyof T, Map<string, Set<string>>>> = {};

  public constructor(
    keys: DBKeys<T> = {},
    private readonly simulatedLatency = 0,
    private readonly stateRef: State = { closed: false },
  ) {
    super(keys);

    this.data = new Map();

    Object.keys(keys).forEach((k) => {
      this.indices[k as keyof T] = new Map();
    });
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
    this.data.set(serialised.id, serialised);
    this.internalPopulateIndices(serialised);
  }

  protected async internalUpsert(
    id: T['id'],
    update: Partial<T>,
  ): Promise<void> {
    if (this.data.has(serialiseValue(id))) {
      await this.internalUpdate('id', id, update);
    } else {
      await this.internalAdd({ id, ...update } as T);
    }
  }

  protected async internalUpdate<K extends keyof T & string>(
    searchAttribute: K,
    searchValue: T[K],
    update: Partial<T>,
  ): Promise<void> {
    const sIds = this.internalGetSerialisedIds(searchAttribute, searchValue);

    const updates = sIds.map((sId) => {
      const oldSerialised = this.data.get(sId)!;
      const oldValue = deserialiseRecord(oldSerialised) as T;
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
      this.data.set(newSerialised.id, newSerialised);
      this.internalPopulateIndices(newSerialised);
    });
  }

  protected async internalGetAll<
    K extends keyof T & string,
    F extends readonly (keyof T & string)[]
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
    return sIds.map((sId) => applyFilter(
      deserialiseRecord(this.data.get(sId)!) as T,
      returnAttributes,
    ));
  }

  protected async internalRemove<K extends keyof T & string>(
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

  private internalGetSerialisedIds<K extends keyof T>(
    searchAttribute: K,
    searchValue: T[K],
  ): string[] {
    const sKey = serialiseValue(searchValue);
    if (searchAttribute === 'id') {
      return this.data.has(sKey) ? [sKey] : [];
    }
    const index = this.indices[searchAttribute];
    if (!index) {
      throw new Error(`Requested key ${searchAttribute} not indexed`);
    }
    const sIds = index.get(sKey);
    return sIds ? [...sIds] : []; // convert set to array
  }

  private internalCheckDuplicates(
    serialisedValue: Record<string, string>,
    checkId: boolean,
  ): void {
    if (checkId && this.data.has(serialisedValue.id)) {
      throw new Error('duplicate');
    }
    Object.keys(this.keys).forEach((key) => {
      const index = this.indices[key as keyof T]!;
      if (this.isIndexUnique(key) && index.has(serialisedValue[key])) {
        throw new Error('duplicate');
      }
    });
  }

  private internalPopulateIndices(
    serialisedValue: Record<string, string>,
  ): void {
    Object.keys(this.keys).forEach((key) => {
      const index = this.indices[key as keyof T]!;
      const v = serialisedValue[key];
      let o = index.get(v);
      if (!o) {
        o = new Set<string>();
        index.set(v, o);
      }
      o.add(serialisedValue.id);
    });
  }

  private internalRemoveIndices(
    serialisedValue: Record<string, string>,
  ): void {
    Object.keys(this.keys).forEach((key) => {
      const index = this.indices[key as keyof T]!;
      const v = serialisedValue[key];
      const o = index.get(v)!;
      o.delete(serialisedValue.id);
      if (!o.size) {
        index.delete(v);
      }
    });
  }
}
