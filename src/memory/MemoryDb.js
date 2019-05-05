import { URL } from 'url';
import MemoryCollection from './MemoryCollection';

const globalNamespace = 'collectionStorageInMemory';

if (!global[globalNamespace]) {
  global[globalNamespace] = new Map();
}

const globalDbs = global[globalNamespace];

export default class MemoryDb {
  static connect(url) {
    const parsedUrl = new URL(url);
    const name = parsedUrl.hostname;
    if (name && globalDbs.has(name)) {
      return globalDbs.get(name);
    }
    const params = parsedUrl.searchParams;
    const simulatedLatency = Number(params.get('simulatedLatency'));
    const db = new MemoryDb({ simulatedLatency });
    if (name) {
      globalDbs.set(name, db);
    }
    return db;
  }

  constructor({ simulatedLatency = 0 } = {}) {
    this.simulatedLatency = simulatedLatency;
    this.mapTables = new Map();
  }

  getCollection(name, keys) {
    if (!this.mapTables.has(name)) {
      this.mapTables.set(name, new MemoryCollection(
        keys,
        this.simulatedLatency,
      ));
    }
    return this.mapTables.get(name);
  }
}
