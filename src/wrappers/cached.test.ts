import { cache } from './cached';
import CollectionStorage from '../CollectionStorage';
import type { Collection } from '../interfaces/Collection';
import type { IDable } from '../interfaces/IDable';

interface TestType {
  id: string;
  unique: string;
  nonunique: string;
}

const INITIAL_TIME = Date.now();
const value = { id: 'i1', unique: 'u1', nonunique: 'n1' };

async function clearAll(col: Collection<IDable>): Promise<void> {
  const items = await col.getAll();
  await Promise.all(items.map(({ id }) => col.remove('id', id)));
}

describe('cache', () => {
  let col: Collection<TestType>;
  let backingCol: Collection<TestType>;
  let currentTime = 0;
  const mockTime = (): number => currentTime;

  beforeEach(async () => {
    const db = await CollectionStorage.connect('memory://');
    backingCol = db.getCollection('cache', {
      unique: { unique: true },
      nonunique: {},
    });
    currentTime = INITIAL_TIME;
    col = cache(backingCol, { capacity: 10, maxAge: 5000, time: mockTime });
  });

  describe('add', () => {
    it('stores values in the backing collection', async () => {
      await col.add(value);

      expect(await backingCol.get('id', 'i1')).toEqual(value);
    });

    it('caches values for a short time', async () => {
      await col.add(value);

      await clearAll(backingCol);

      expect(await col.get('id', 'i1')).toEqual(value);
    });

    it('does not cache failed items', async () => {
      await col.add(value);
      await expect(col.add({ id: 'i1', unique: 'u2', nonunique: 'n2' })).rejects.not.toBeNull();

      expect(await col.get('id', 'i1')).toEqual(value);
    });
  });

  describe('get', () => {
    it('caches values for a short time', async () => {
      await backingCol.add(value);
      await col.get('id', 'i1'); // cache value

      await clearAll(backingCol);

      expect(await col.get('id', 'i1')).toEqual(value);
    });

    it('retrieves values from the backing collection if not cached', async () => {
      await backingCol.add(value);

      expect(await col.get('id', 'i1')).toEqual(value);
    });

    it('retrieves values from the backing collection if cache has expired', async () => {
      await col.add(value);

      await clearAll(backingCol);
      expect(await col.get('id', 'i1')).not.toBeNull();

      currentTime += 6000;

      expect(await col.get('id', 'i1')).toBeNull();
    });

    it('caches nonexistent values', async () => {
      await col.get('id', 'i1'); // cache non-existing value

      await backingCol.add(value);

      expect(await col.get('id', 'i1')).toBeNull();
    });
  });

  describe('remove', () => {
    it('removes values from the backing collection', async () => {
      await backingCol.add(value);
      expect(await col.remove('id', 'i1')).toEqual(1);

      expect(await backingCol.get('id', 'i1')).toBeNull();
    });

    it('caches removal if the value existed', async () => {
      await backingCol.add(value);
      expect(await col.remove('id', 'i1')).toEqual(1);

      await backingCol.add(value);

      expect(await col.get('id', 'i1')).toBeNull();
    });

    it('does not cache removal of non-existing values', async () => {
      expect(await col.remove('id', 'i1')).toEqual(0);

      await backingCol.add(value);

      expect(await col.get('id', 'i1')).toEqual(value);
    });
  });

  describe('partially cached values', () => {
    it('uses partial caches if compatible with the request', async () => {
      await backingCol.add(value);
      await col.get('id', 'i1', ['nonunique']); // cache partial value (id + nonunique)
      await clearAll(backingCol);

      const cacheValue = await col.get('id', 'i1', ['nonunique']);
      expect(cacheValue).toEqual({ nonunique: 'n1' });
    });

    it('includes implicit information (cache lookup key)', async () => {
      await backingCol.add(value);
      await col.get('id', 'i1', ['nonunique']); // cache partial value (id + nonunique)
      await clearAll(backingCol);

      const cacheValue = await col.get('id', 'i1', ['id', 'nonunique']);
      expect(cacheValue).toEqual({ id: 'i1', nonunique: 'n1' });
    });

    it('checks backing collection if uncached attributes are requested', async () => {
      await backingCol.add(value);
      await col.get('id', 'i1', ['nonunique']); // cache partial value (id + nonunique)
      await clearAll(backingCol);

      const cacheValue = await col.get('id', 'i1', ['id', 'unique']);
      expect(cacheValue).toBeNull();
    });

    it('checks backing collection if all attributes are requested', async () => {
      await backingCol.add(value);
      await col.get('id', 'i1', ['nonunique']); // cache partial value (id + nonunique)
      await clearAll(backingCol);

      const cacheValue = await col.get('id', 'i1');
      expect(cacheValue).toBeNull();
    });

    it('refreshes item if unexpected data is found', async () => {
      await backingCol.add(value);
      await col.get('unique', 'u1', ['id']); // cache partial value (id + unique)
      await backingCol.update('id', 'i1', { unique: 'u2' });

      expect(await col.get('unique', 'u1')).toBeNull(); // request uncached attributes

      await clearAll(backingCol);

      expect(await col.get('id', 'i1', ['unique'])).toEqual({ unique: 'u2' });
    });
  });

  describe('unique indices', () => {
    it('retrieves cached values by unique index', async () => {
      await backingCol.add(value);
      await col.get('unique', 'u1'); // cache value by unique index

      await clearAll(backingCol);

      expect(await col.get('unique', 'u1')).toEqual(value);
    });

    it('retrieves cached values by unique index regardless of how they became cached', async () => {
      await backingCol.add(value);
      await col.get('id', 'i1'); // cache value by ID

      await clearAll(backingCol);

      expect(await col.get('unique', 'u1')).toEqual(value);
    });

    it('retrieves cached values by ID regardless of how they became cached', async () => {
      await backingCol.add(value);
      await col.get('unique', 'u1'); // cache value by unique index

      await clearAll(backingCol);

      expect(await col.get('id', 'i1')).toEqual(value);
    });

    it('does not return known-stale items', async () => {
      await col.add(value);
      await col.update('id', 'i1', { unique: 'u2' });

      await clearAll(backingCol);

      expect(await col.get('unique', 'u1')).toBeNull();
      expect(await col.get('unique', 'u2')).not.toBeNull();
    });

    it('removes old item if a new item conflicts', async () => {
      await col.add(value);
      await clearAll(backingCol);

      const value2 = { id: 'i2', unique: 'u1', nonunique: 'n2' };
      await col.add(value2);

      await clearAll(backingCol);

      expect(await col.get('unique', 'u1')).toEqual(value2);
      expect(await col.get('id', 'i1')).toBeNull();
    });

    it('does not remove old item if a new conflicting item fails', async () => {
      await col.add(value);

      const value2 = { id: 'i2', unique: 'u1', nonunique: 'n2' };
      await expect(col.add(value2)).rejects.not.toBeNull();

      await clearAll(backingCol);

      expect(await col.get('unique', 'u1')).toEqual(value);
      expect(await col.get('id', 'i1')).toEqual(value);
      expect(await col.get('id', 'i2')).toBeNull();
    });
  });

  describe('nonunique indices', () => {
    it('caches values when retrieving by nonunique index', async () => {
      await backingCol.add(value);
      await col.get('nonunique', 'n1'); // cache value

      await clearAll(backingCol);

      expect(await col.get('id', 'i1')).toEqual(value);
    });

    it('does not use cache for nonunique index lookups', async () => {
      await backingCol.add(value);
      await col.get('nonunique', 'n1'); // cache value

      await clearAll(backingCol);

      expect(await col.get('nonunique', 'n1')).toBeNull();
    });

    it('removes values from the cache which were expected but not seen by get', async () => {
      await col.add({ id: 'i1', unique: 'u1', nonunique: 'n1' });
      await col.add({ id: 'i2', unique: 'u2', nonunique: 'n1' });
      await col.add({ id: 'i3', unique: 'u3', nonunique: 'n2' });

      await backingCol.remove('id', 'i2');
      await backingCol.remove('id', 'i3');

      await col.get('nonunique', 'n1'); // update cache
      await col.get('nonunique', 'n2'); // update cache

      await clearAll(backingCol);

      expect(await col.get('id', 'i1')).not.toBeNull(); // still exists
      expect(await col.get('id', 'i2')).not.toBeNull(); // could still exist (get returned a value)
      expect(await col.get('id', 'i3')).toBeNull(); // detected removed (get returned null)
    });

    it('removes values from the cache which were expected but not seen by getAll', async () => {
      await col.add({ id: 'i1', unique: 'u1', nonunique: 'n1' });
      await col.add({ id: 'i2', unique: 'u2', nonunique: 'n1' });
      await col.add({ id: 'i3', unique: 'u3', nonunique: 'n2' });

      await backingCol.remove('id', 'i2');
      await backingCol.remove('id', 'i3');

      await col.getAll('nonunique', 'n1'); // update cache

      await clearAll(backingCol);

      expect(await col.get('id', 'i1')).not.toBeNull(); // still exists
      expect(await col.get('id', 'i2')).toBeNull(); // detected removed (not present in result of getAll)
      expect(await col.get('id', 'i3')).not.toBeNull(); // not checked
    });
  });

  describe('getAll', () => {
    it('updates the entire cache', async () => {
      await col.add({ id: 'i1', unique: 'u1', nonunique: 'n1' });
      await col.add({ id: 'i2', unique: 'u2', nonunique: 'n1' });
      await col.add({ id: 'i3', unique: 'u3', nonunique: 'n2' });

      await backingCol.remove('id', 'i2');
      await backingCol.remove('id', 'i3');
      await backingCol.add({ id: 'i4', unique: 'u4', nonunique: 'n4' });

      await col.getAll(); // update cache

      await clearAll(backingCol);

      expect(await col.get('id', 'i1')).not.toBeNull();
      expect(await col.get('id', 'i2')).toBeNull();
      expect(await col.get('id', 'i3')).toBeNull();
      expect(await col.get('id', 'i4')).not.toBeNull();
    });
  });
});
