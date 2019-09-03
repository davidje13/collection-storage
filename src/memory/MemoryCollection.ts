import Collection, { KeyOptions } from '../interfaces/Collection';
import IDable from '../interfaces/IDable';
import { DBKeys } from '../interfaces/DB';

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

interface KeyInfo<ID, T> {
  map: Map<T, Set<ID>>;
  options: KeyOptions;
}

export default class MemoryCollection<T extends IDable> implements Collection<T> {
  private readonly data: Map<T['id'], string>;

  private readonly keyList: (keyof T)[] = [];

  private readonly keys: { [K in keyof T]?: KeyInfo<T['id'], T[K]> } = {};

  public constructor(
    keys: DBKeys<T> = {},
    private readonly simulatedLatency = 0,
  ) {
    this.data = new Map();

    Object.keys(keys).forEach((k) => {
      const key = k as keyof DBKeys<T>;
      this.keyList.push(key);
      this.keys[key] = { map: new Map(), options: keys[key]! };
    });
  }

  public async add(value: T): Promise<void> {
    await sleep(this.simulatedLatency);

    this.internalCheckDuplicates(value, true);
    this.data.set(value.id, JSON.stringify(value));
    this.internalPopulateIndices(value);
  }

  public async update<K extends keyof T & string>(
    keyName: K,
    key: T[K],
    value: Partial<T>,
    { upsert = false } = {},
  ): Promise<void> {
    await sleep(this.simulatedLatency);

    const id = this.internalGetIds(keyName, key)[0];
    if (id === undefined) {
      if (upsert) {
        await this.add(Object.assign({ [keyName]: key }, value as T));
      }
      return;
    }
    const oldValue = JSON.parse(this.data.get(id)!) as T;
    const newValue = Object.assign({}, oldValue, value);
    if (newValue.id !== oldValue.id) {
      throw new Error('Cannot update id');
    }
    this.internalRemoveIndices(oldValue);
    try {
      this.internalCheckDuplicates(newValue, false);
    } catch (e) {
      this.internalPopulateIndices(oldValue);
      throw e;
    }
    this.data.set(newValue.id, JSON.stringify(newValue));
    this.internalPopulateIndices(newValue);
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
    await sleep(this.simulatedLatency);

    let ids: T['id'][];
    if (keyName) {
      ids = this.internalGetIds(keyName, key!);
    } else {
      ids = [...this.data.keys()];
    }
    return ids.map((id) => applyFilter(
      JSON.parse(this.data.get(id)!),
      fields,
    ));
  }

  public async remove<K extends keyof T & string>(
    key: K,
    value: T[K],
  ): Promise<number> {
    await sleep(this.simulatedLatency);

    const ids = this.internalGetIds(key, value);
    ids.forEach((id) => {
      const oldValue = JSON.parse(this.data.get(id)!) as T;
      this.internalRemoveIndices(oldValue);
      this.data.delete(id);
    });

    return ids.length;
  }

  private internalGetIds<K extends keyof T>(
    keyName: K,
    key: T[K],
  ): T['id'][] {
    if (keyName === 'id') {
      const idKey = key as T['id'];
      return this.data.has(idKey) ? [idKey] : [];
    }
    const keyInfo = this.keys[keyName];
    if (!keyInfo) {
      throw new Error(`Requested key ${keyName} not indexed`);
    }
    const ids = keyInfo.map.get(key);
    return ids ? [...ids] : []; // convert set to array
  }

  private internalCheckDuplicates(value: T, checkId: boolean): void {
    if (checkId && this.data.has(value.id)) {
      throw new Error('duplicate');
    }
    this.keyList.forEach((key) => {
      const { map, options } = this.keys[key]!;
      if (options.unique && map.has(value[key])) {
        throw new Error('duplicate');
      }
    });
  }

  private internalPopulateIndices(value: T): void {
    this.keyList.forEach((key) => {
      const { map } = this.keys[key]!;
      const v = value[key];
      let o = map.get(v);
      if (!o) {
        o = new Set<T['id']>();
        map.set(v, o);
      }
      o.add(value.id);
    });
  }

  private internalRemoveIndices(value: T): void {
    this.keyList.forEach((key) => {
      const { map } = this.keys[key]!;
      const v = value[key];
      const o = map.get(v)!;
      o.delete(value.id);
      if (!o.size) {
        map.delete(v);
      }
    });
  }
}
