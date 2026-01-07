import { MemoryCollection, type DBBackingData } from './MemoryCollection.mts';
import type { DBKeys } from '../interfaces/DB.mts';
import type { IDable } from '../interfaces/IDable.mts';
import { BaseDB } from '../interfaces/BaseDB.mts';

function getGlobal<T>(key: symbol, initial: T): T {
  const existing = (global as any)[key];
  if (existing) {
    return existing;
  }

  (global as any)[key] = initial;
  return initial;
}

const globalDbs = getGlobal(
  Symbol.for('collectionStorageInMemory'),
  new Map<string, DBBackingData>(),
);

export class MemoryDB extends BaseDB {
  /** @internal */ private readonly _backingData: DBBackingData;
  /** @internal */ private readonly _simulatedLatency: number;

  /** @internal */ private constructor(backingData: DBBackingData, simulatedLatency: number) {
    super();
    this._backingData = backingData;
    this._simulatedLatency = simulatedLatency;
  }

  static connect(url: string): MemoryDB {
    const parsedUrl = new URL(url);
    const name = parsedUrl.hostname;
    let backingData = globalDbs.get(name);
    if (!backingData) {
      backingData = new Map();
      if (name) {
        globalDbs.set(name, backingData);
      }
    }
    const params = parsedUrl.searchParams;
    const simulatedLatency = Number(params.get('simulatedLatency'));
    return new MemoryDB(backingData, Number.isNaN(simulatedLatency) ? 0 : simulatedLatency);
  }

  getCollection<T extends IDable>(name: string, keys?: DBKeys<T>): MemoryCollection<T> {
    return this.get(
      name,
      keys,
      (options) => new MemoryCollection(options, this._backingData, this._simulatedLatency),
    );
  }
}
