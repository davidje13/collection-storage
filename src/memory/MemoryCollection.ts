import Collection, { KeyOptions } from '../interfaces/Collection';
import IDable from '../interfaces/IDable';
import { DBKeys } from '../interfaces/DB';
import {
  serialiseValue,
  serialiseRecord,
  deserialiseRecord,
} from '../helpers/serialiser';

function sleep(millis: number): Promise<void> | null {
  if (!millis) {
    return null;
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

interface KeyInfo {
  map: Map<string, Set<string>>;
  options: KeyOptions;
}

interface State {
  closed: boolean;
}

export default class MemoryCollection<T extends IDable> implements Collection<T> {
  private readonly data: Map<string, Record<string, string>>;

  private readonly keys: { [K in keyof T]?: KeyInfo } = {};

  public constructor(
    keys: DBKeys<T> = {},
    private readonly simulatedLatency = 0,
    private readonly stateRef: State = { closed: false },
  ) {
    this.data = new Map();

    Object.keys(keys).forEach((k) => {
      const key = k as keyof DBKeys<T>;
      this.keys[key] = { map: new Map(), options: keys[key]! };
    });
  }

  public async add(value: T): Promise<void> {
    await this.simulateDbConnection();

    const serialised = serialiseRecord(value);
    this.internalCheckDuplicates(serialised, true);
    this.data.set(serialised.id, serialised);
    this.internalPopulateIndices(serialised);
  }

  public async update<K extends keyof T & string>(
    keyName: K,
    key: T[K],
    value: Partial<T>,
    { upsert = false } = {},
  ): Promise<void> {
    if (upsert && keyName !== 'id') {
      throw new Error(`Can only upsert by ID, not ${keyName}`);
    }

    await this.simulateDbConnection();

    const sId = this.internalGetSerialisedIds(keyName, key)[0];
    if (sId === undefined) {
      if (upsert) {
        const fullValue = { [keyName]: key, ...value };
        const serialised = serialiseRecord(fullValue);
        this.internalCheckDuplicates(serialised, true);
        this.data.set(serialised.id, serialised);
        this.internalPopulateIndices(serialised);
      }
      return;
    }
    const oldSerialised = this.data.get(sId)!;
    const oldValue = deserialiseRecord(oldSerialised) as T;
    const newValue = { ...oldValue, ...value };
    if (newValue.id !== oldValue.id) {
      throw new Error('Cannot update id');
    }
    const newSerialised = serialiseRecord(newValue);
    this.internalRemoveIndices(oldSerialised);
    try {
      this.internalCheckDuplicates(newSerialised, false);
    } catch (e) {
      this.internalPopulateIndices(oldSerialised);
      throw e;
    }
    this.data.set(newSerialised.id, newSerialised);
    this.internalPopulateIndices(newSerialised);
  }

  public async get<
    K extends keyof T & string,
    F extends readonly (keyof T & string)[]
  >(
    keyName: K,
    key: T[K],
    fields?: F,
  ): Promise<Readonly<Pick<T, F[-1]>> | null> {
    const all = await this.getAll(keyName, key, fields);
    if (!all.length) {
      return null;
    }
    return all[0];
  }

  public async getAll<
    K extends keyof T & string,
    F extends readonly (keyof T & string)[]
  >(
    keyName?: K,
    key?: T[K],
    fields?: F,
  ): Promise<Readonly<Pick<T, F[-1]>>[]> {
    await this.simulateDbConnection();

    let sIds: string[];
    if (keyName) {
      sIds = this.internalGetSerialisedIds(keyName, key!);
    } else {
      sIds = [...this.data.keys()];
    }
    return sIds.map((sId) => applyFilter(
      deserialiseRecord(this.data.get(sId)!) as T,
      fields,
    ));
  }

  public async remove<K extends keyof T & string>(
    key: K,
    value: T[K],
  ): Promise<number> {
    await this.simulateDbConnection();

    const sIds = this.internalGetSerialisedIds(key, value);
    sIds.forEach((sId) => {
      const oldSerialised = this.data.get(sId)!;
      this.internalRemoveIndices(oldSerialised);
      this.data.delete(sId);
    });

    return sIds.length;
  }

  private async simulateDbConnection(): Promise<void> {
    if (this.stateRef.closed) {
      throw new Error('Connection closed');
    }
    await sleep(this.simulatedLatency);
  }

  private internalGetSerialisedIds<K extends keyof T>(
    keyName: K,
    key: T[K],
  ): string[] {
    const sKey = serialiseValue(key);
    if (keyName === 'id') {
      return this.data.has(sKey) ? [sKey] : [];
    }
    const keyInfo = this.keys[keyName];
    if (!keyInfo) {
      throw new Error(`Requested key ${keyName} not indexed`);
    }
    const sIds = keyInfo.map.get(sKey);
    return sIds ? [...sIds] : []; // convert set to array
  }

  private internalCheckDuplicates(
    serialisedValue: Record<string, string>,
    checkId: boolean,
  ): void {
    if (checkId && this.data.has(serialisedValue.id)) {
      throw new Error('duplicate');
    }
    Object.entries(this.keys).forEach(([key, keyInfo]) => {
      const { map, options } = keyInfo!;
      if (options.unique && map.has(serialisedValue[key])) {
        throw new Error('duplicate');
      }
    });
  }

  private internalPopulateIndices(
    serialisedValue: Record<string, string>,
  ): void {
    Object.entries(this.keys).forEach(([key, keyInfo]) => {
      const { map } = keyInfo!;
      const v = serialisedValue[key];
      let o = map.get(v);
      if (!o) {
        o = new Set<string>();
        map.set(v, o);
      }
      o.add(serialisedValue.id);
    });
  }

  private internalRemoveIndices(
    serialisedValue: Record<string, string>,
  ): void {
    Object.entries(this.keys).forEach(([key, keyInfo]) => {
      const { map } = keyInfo!;
      const v = serialisedValue[key];
      const o = map.get(v)!;
      o.delete(serialisedValue.id);
      if (!o.size) {
        map.delete(v);
      }
    });
  }
}
