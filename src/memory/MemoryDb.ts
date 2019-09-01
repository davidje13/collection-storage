import { URL } from 'url';
import MemoryCollection from './MemoryCollection';
import DB, { DBKeys } from '../DB';
import IDable from '../IDable';

function getGlobal<T>(name: string, initial: T): T {
  const existing = (global as any)[name];
  if (existing) {
    return existing;
  }

  (global as any)[name] = initial;
  return initial;
}

const globalDbs = getGlobal(
  'collectionStorageInMemory',
  new Map<string, MemoryDb>(),
);

export default class MemoryDb implements DB {
  private readonly simulatedLatency: number;

  private readonly mapTables = new Map<string, MemoryCollection<any>>();

  public constructor({ simulatedLatency = 0 } = {}) {
    this.simulatedLatency = simulatedLatency;
  }

  public static connect(url: string): MemoryDb {
    const parsedUrl = new URL(url);
    const name = parsedUrl.hostname;
    if (name && globalDbs.has(name)) {
      return globalDbs.get(name)!;
    }
    const params = parsedUrl.searchParams;
    const simulatedLatency = Number(params.get('simulatedLatency'));
    const db = new MemoryDb({ simulatedLatency });
    if (name) {
      globalDbs.set(name, db);
    }
    return db;
  }

  public getCollection<T extends IDable>(
    name: string,
    keys?: DBKeys<T>,
  ): MemoryCollection<T> {
    if (!this.mapTables.has(name)) {
      this.mapTables.set(name, new MemoryCollection(
        keys,
        this.simulatedLatency,
      ));
    }
    return this.mapTables.get(name)! as MemoryCollection<T>;
  }
}
