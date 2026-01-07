import { fromAsync, withCollection, withDB } from '../../test-helpers/db.contract-test.mts';
import type { Collection } from '../interfaces/Collection.mts';
import { MemoryDB } from '../memory/MemoryDB.mts';
import { cache } from './cached.mts';
import 'lean-test';

interface TestType {
  id: string;
  unique: string;
  nonunique: string;
}

const INITIAL_TIME = Date.now();
const value = { id: 'i1', unique: 'u1', nonunique: 'n1' };

describe('cache', () => {
  const mockTime = beforeEach<{ time: number; fn: () => number }>(({ setParameter }) => {
    const o = { time: INITIAL_TIME, fn: () => o.time };
    setParameter(o);
  });

  const db = withDB(() => MemoryDB.connect('memory://'));
  const backingCol = withCollection<TestType>(db, { unique: { unique: true }, nonunique: {} }, []);
  const col = beforeEach<Collection<TestType>>(({ getTyped, setParameter }) => {
    setParameter(
      cache(getTyped(backingCol), { capacity: 10, maxAge: 5000, time: getTyped(mockTime).fn }),
    );
  });

  it(
    'does not wrap the collection if no cache is requested',
    { timeout: 5000 },
    async ({ getTyped }) => {
      const backing = getTyped(backingCol);
      expect(cache(backing, { capacity: 0 })).toBe(backing);
      expect(cache(backing, { maxAge: -1 })).toBe(backing);
    },
  );

  describe('add', () => {
    it('stores values in the backing collection', { timeout: 5000 }, async ({ getTyped }) => {
      await getTyped(col).add(value);

      expect(await getTyped(backingCol).where('id', 'i1').get()).toEqual(value);
    });

    it('caches values for a short time', { timeout: 5000 }, async ({ getTyped }) => {
      await getTyped(col).add(value);

      await getTyped(backingCol).all().remove();

      expect(await getTyped(col).where('id', 'i1').get()).toEqual(value);
    });

    it('does not cache failed items', { timeout: 5000 }, async ({ getTyped }) => {
      await getTyped(col).add(value);
      await expect(() => getTyped(col).add({ id: 'i1', unique: 'u2', nonunique: 'n2' })).throws();

      expect(await getTyped(col).where('id', 'i1').get()).toEqual(value);
    });
  });

  describe('get', () => {
    it('caches values for a short time', { timeout: 5000 }, async ({ getTyped }) => {
      await getTyped(backingCol).add(value);
      await getTyped(col).where('id', 'i1').get(); // cache value

      await getTyped(backingCol).all().remove();

      expect(await getTyped(col).where('id', 'i1').get()).toEqual(value);
    });

    it(
      'retrieves values from the backing collection if not cached',
      { timeout: 5000 },
      async ({ getTyped }) => {
        await getTyped(backingCol).add(value);

        expect(await getTyped(col).where('id', 'i1').get()).toEqual(value);
      },
    );

    it(
      'retrieves values from the backing collection if cache has expired',
      { timeout: 5000 },
      async ({ getTyped }) => {
        await getTyped(col).add(value);

        await getTyped(backingCol).all().remove();
        expect(await getTyped(col).where('id', 'i1').get()).not(toBeNull());

        getTyped(mockTime).time += 6000;

        expect(await getTyped(col).where('id', 'i1').get()).toBeNull();
      },
    );

    it('caches nonexistent values', { timeout: 5000 }, async ({ getTyped }) => {
      await getTyped(col).where('id', 'i1').get(); // cache non-existing value

      await getTyped(backingCol).add(value);

      expect(await getTyped(col).where('id', 'i1').get()).toBeNull();
    });
  });

  describe('remove', () => {
    it('removes values from the backing collection', { timeout: 5000 }, async ({ getTyped }) => {
      await getTyped(backingCol).add(value);
      expect(await getTyped(col).where('id', 'i1').remove()).toEqual(1);

      expect(await getTyped(backingCol).where('id', 'i1').get()).toBeNull();
    });

    it('caches removal if the value existed', { timeout: 5000 }, async ({ getTyped }) => {
      await getTyped(backingCol).add(value);
      expect(await getTyped(col).where('id', 'i1').remove()).toEqual(1);

      await getTyped(backingCol).add(value);

      expect(await getTyped(col).where('id', 'i1').get()).toBeNull();
    });

    it('does not cache removal of non-existing values', { timeout: 5000 }, async ({ getTyped }) => {
      expect(await getTyped(col).where('id', 'i1').remove()).toEqual(0);

      await getTyped(backingCol).add(value);

      expect(await getTyped(col).where('id', 'i1').get()).toEqual(value);
    });
  });

  describe('partially cached values', () => {
    it(
      'uses partial caches if compatible with the request',
      { timeout: 5000 },
      async ({ getTyped }) => {
        await getTyped(backingCol).add(value);
        await getTyped(col).where('id', 'i1').attrs(['nonunique']).get(); // cache partial value (id + nonunique)
        await getTyped(backingCol).all().remove();

        const cacheValue = await getTyped(col).where('id', 'i1').attrs(['nonunique']).get();
        expect(cacheValue).toEqual({ nonunique: 'n1' });
      },
    );

    it(
      'includes implicit information (cache lookup key)',
      { timeout: 5000 },
      async ({ getTyped }) => {
        await getTyped(backingCol).add(value);
        await getTyped(col).where('id', 'i1').attrs(['nonunique']).get(); // cache partial value (id + nonunique)
        await getTyped(backingCol).all().remove();

        const cacheValue = await getTyped(col).where('id', 'i1').attrs(['id', 'nonunique']).get();
        expect(cacheValue).toEqual({ id: 'i1', nonunique: 'n1' });
      },
    );

    it(
      'checks backing collection if uncached attributes are requested',
      { timeout: 5000 },
      async ({ getTyped }) => {
        await getTyped(backingCol).add(value);
        await getTyped(col).where('id', 'i1').attrs(['nonunique']).get(); // cache partial value (id + nonunique)
        await getTyped(backingCol).all().remove();

        const cacheValue = await getTyped(col).where('id', 'i1').attrs(['id', 'unique']).get();
        expect(cacheValue).toBeNull();
      },
    );

    it(
      'checks backing collection if all attributes are requested',
      { timeout: 5000 },
      async ({ getTyped }) => {
        await getTyped(backingCol).add(value);
        await getTyped(col).where('id', 'i1').attrs(['nonunique']).get(); // cache partial value (id + nonunique)
        await getTyped(backingCol).all().remove();

        const cacheValue = await getTyped(col).where('id', 'i1').get();
        expect(cacheValue).toBeNull();
      },
    );

    it('refreshes item if unexpected data is found', { timeout: 5000 }, async ({ getTyped }) => {
      await getTyped(backingCol).add(value);
      await getTyped(col).where('unique', 'u1').attrs(['id']).get(); // cache partial value (id + unique)
      await getTyped(backingCol).where('id', 'i1').update({ unique: 'u2' });

      expect(await getTyped(col).where('unique', 'u1').get()).toBeNull(); // request uncached attributes

      await getTyped(backingCol).all().remove();

      expect(await getTyped(col).where('id', 'i1').attrs(['unique']).get()).toEqual({
        unique: 'u2',
      });
    });
  });

  describe('unique indices', () => {
    it('retrieves cached values by unique index', { timeout: 5000 }, async ({ getTyped }) => {
      await getTyped(backingCol).add(value);
      await getTyped(col).where('unique', 'u1').get(); // cache value by unique index

      await getTyped(backingCol).all().remove();

      expect(await getTyped(col).where('unique', 'u1').get()).toEqual(value);
    });

    it(
      'retrieves cached values by unique index regardless of how they became cached',
      { timeout: 5000 },
      async ({ getTyped }) => {
        await getTyped(backingCol).add(value);
        await getTyped(col).where('id', 'i1').get(); // cache value by ID

        await getTyped(backingCol).all().remove();

        expect(await getTyped(col).where('unique', 'u1').get()).toEqual(value);
      },
    );

    it(
      'retrieves cached values by ID regardless of how they became cached',
      { timeout: 5000 },
      async ({ getTyped }) => {
        await getTyped(backingCol).add(value);
        await getTyped(col).where('unique', 'u1').get(); // cache value by unique index

        await getTyped(backingCol).all().remove();

        expect(await getTyped(col).where('id', 'i1').get()).toEqual(value);
      },
    );

    it('does not return known-stale items', { timeout: 5000 }, async ({ getTyped }) => {
      await getTyped(col).add(value);
      await getTyped(col).where('id', 'i1').update({ unique: 'u2' });

      await getTyped(backingCol).all().remove();

      expect(await getTyped(col).where('unique', 'u1').get()).toBeNull();
      expect(await getTyped(col).where('unique', 'u2').get()).not(toBeNull());
    });

    it('removes old item if a new item conflicts', { timeout: 5000 }, async ({ getTyped }) => {
      await getTyped(col).add(value);
      await getTyped(backingCol).all().remove();

      const value2 = { id: 'i2', unique: 'u1', nonunique: 'n2' };
      await getTyped(col).add(value2);

      await getTyped(backingCol).all().remove();

      expect(await getTyped(col).where('unique', 'u1').get()).toEqual(value2);
      expect(await getTyped(col).where('id', 'i1').get()).toBeNull();
    });

    it(
      'does not remove old item if a new conflicting item fails',
      { timeout: 5000 },
      async ({ getTyped }) => {
        await getTyped(col).add(value);

        const value2 = { id: 'i2', unique: 'u1', nonunique: 'n2' };
        await expect(() => getTyped(col).add(value2)).throws();

        await getTyped(backingCol).all().remove();

        expect(await getTyped(col).where('unique', 'u1').get()).toEqual(value);
        expect(await getTyped(col).where('id', 'i1').get()).toEqual(value);
        expect(await getTyped(col).where('id', 'i2').get()).toBeNull();
      },
    );
  });

  describe('nonunique indices', () => {
    it(
      'caches values when retrieving by nonunique index',
      { timeout: 5000 },
      async ({ getTyped }) => {
        await getTyped(backingCol).add(value);
        await getTyped(col).where('nonunique', 'n1').get(); // cache value

        await getTyped(backingCol).all().remove();

        expect(await getTyped(col).where('id', 'i1').get()).toEqual(value);
      },
    );

    it(
      'does not use cache for nonunique index lookups',
      { timeout: 5000 },
      async ({ getTyped }) => {
        await getTyped(backingCol).add(value);
        await getTyped(col).where('nonunique', 'n1').get(); // cache value

        await getTyped(backingCol).all().remove();

        expect(await getTyped(col).where('nonunique', 'n1').get()).toBeNull();
      },
    );

    it(
      'removes values from the cache which were expected but not seen by get',
      { timeout: 5000 },
      async ({ getTyped }) => {
        await getTyped(col).add(
          { id: 'i1', unique: 'u1', nonunique: 'n1' },
          { id: 'i2', unique: 'u2', nonunique: 'n1' },
          { id: 'i3', unique: 'u3', nonunique: 'n2' },
        );

        await getTyped(backingCol).where('id', 'i2').remove();
        await getTyped(backingCol).where('id', 'i3').remove();

        await getTyped(col).where('nonunique', 'n1').get(); // update cache
        await getTyped(col).where('nonunique', 'n2').get(); // update cache

        await getTyped(backingCol).all().remove();

        expect(await getTyped(col).where('id', 'i1').get()).not(toBeNull()); // still exists
        expect(await getTyped(col).where('id', 'i2').get()).not(toBeNull()); // could still exist (get returned a value)
        expect(await getTyped(col).where('id', 'i3').get()).toBeNull(); // detected removed (get returned null)
      },
    );

    it(
      'removes values from the cache which were expected but not seen by getAll',
      { timeout: 5000 },
      async ({ getTyped }) => {
        await getTyped(col).add(
          { id: 'i1', unique: 'u1', nonunique: 'n1' },
          { id: 'i2', unique: 'u2', nonunique: 'n1' },
          { id: 'i3', unique: 'u3', nonunique: 'n2' },
        );

        await getTyped(backingCol).where('id', 'i2').remove();
        await getTyped(backingCol).where('id', 'i3').remove();

        await fromAsync(getTyped(col).where('nonunique', 'n1').values()); // update cache

        await getTyped(backingCol).all().remove();

        expect(await getTyped(col).where('id', 'i1').get()).not(toBeNull()); // still exists
        expect(await getTyped(col).where('id', 'i2').get()).toBeNull(); // detected removed (not present in result of getAll)
        expect(await getTyped(col).where('id', 'i3').get()).not(toBeNull()); // not checked
      },
    );
  });

  describe('getAll', () => {
    it('updates the entire cache', { timeout: 5000 }, async ({ getTyped }) => {
      await getTyped(col).add(
        { id: 'i1', unique: 'u1', nonunique: 'n1' },
        { id: 'i2', unique: 'u2', nonunique: 'n1' },
        { id: 'i3', unique: 'u3', nonunique: 'n2' },
      );

      await getTyped(backingCol).where('id', 'i2').remove();
      await getTyped(backingCol).where('id', 'i3').remove();
      await getTyped(backingCol).add({ id: 'i4', unique: 'u4', nonunique: 'n4' });

      await fromAsync(getTyped(col).all().values()); // update cache

      await getTyped(backingCol).all().remove();

      expect(await getTyped(col).where('id', 'i1').get()).not(toBeNull());
      expect(await getTyped(col).where('id', 'i2').get()).toBeNull();
      expect(await getTyped(col).where('id', 'i3').get()).toBeNull();
      expect(await getTyped(col).where('id', 'i4').get()).not(toBeNull());
    });
  });
});
