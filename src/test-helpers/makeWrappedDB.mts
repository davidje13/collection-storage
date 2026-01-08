import type { DB } from '../core/interfaces/DB.mts';
import type { Collection } from '../core/interfaces/Collection.mts';

export function makeWrappedDB(base: DB, wrapper: (base: Collection<any>) => Collection<any>): DB {
  const collectionMap = new WeakMap<Collection<any>, Collection<any>>();
  return {
    close() {
      return base.close();
    },
    get closed() {
      return base.closed;
    },
    getCollection(name, keys) {
      const baseC = base.getCollection(name, keys);
      let mapped = collectionMap.get(baseC);
      if (!mapped) {
        mapped = wrapper(baseC);
        collectionMap.set(baseC, mapped);
      }
      return mapped;
    },
  };
}
