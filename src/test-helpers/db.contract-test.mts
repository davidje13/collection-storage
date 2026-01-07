import type { TypedParameter, TypedParameters } from 'lean-test';
import type { DB, DBKeys } from '../core/interfaces/DB.mts';
import type { Collection } from '../core/interfaces/Collection.mts';
import type { IDable } from '../core/interfaces/IDable.mts';
import 'lean-test';

const vanillaIt = it;

export const contract = <T extends DB>({
  factory,
  migrationFactory = () => factory(true),
  testWrapper, // like beforeEach, but runs after any test prep has completed
  testMigration = true,
}: {
  factory: (persist: boolean) => Promise<T> | T;
  migrationFactory?: (existing: T) => Promise<T> | T;
  testWrapper?: (options: TypedParameters & { db: T }) => (() => void) | void;
  testMigration?: boolean;
}) => {
  const db = beforeEach<T>(async ({ setParameter, testPath }) => {
    const db = await factory(testPath.includes('data migration'));
    setParameter(db);
    return () => db.close();
  });

  const it = async (
    name: string,
    fn: (options: TypedParameters & { db: T }, ...args: any[]) => Promise<void> | void,
    options?: { timeout?: number },
  ) => {
    vanillaIt(name, { timeout: 5000, ...options }, async (options, ...rest) => {
      const augmentedOptions = { ...options, db: options.getTyped(db) };
      const teardown = testWrapper?.(augmentedOptions);
      await fn(augmentedOptions, ...rest);
      teardown?.();
    });
  };

  it('stores and retrieves data', async ({ getTyped }) => {
    const col = getTyped(db).getCollection<{ id: string; value: string }>('test-simple');

    const stored = { id: '1', value: 'foo' };
    await col.add(stored);

    const retrieved = await col.where('id', stored.id).get();

    expect(retrieved).toEqual(stored);
    expect(retrieved).not(toBe(stored));
  });

  it('stores and retrieves JSON data', async ({ getTyped }) => {
    const stored = { id: '1', value: { nested: ['hi', { object: 3 }] } };
    const col = getTyped(db).getCollection<typeof stored>(getUniqueName());

    await col.add(stored);

    const retrieved = await col.where('id', stored.id).get();

    expect(retrieved!.value).toEqual(stored.value);
    expect(retrieved).not(toBe(stored));
  });

  it('stores and retrieves binary data', async ({ getTyped }) => {
    const stored = { id: '1', value: Buffer.from('hello', 'utf8') };
    const col = getTyped(db).getCollection<typeof stored>(getUniqueName());

    await col.add(stored);

    const retrieved = await col.where('id', stored.id).get();

    expect([...retrieved!.value]).toEqual([...stored.value]);
    expect(retrieved).not(toBe(stored));
  });

  it('allows duplicates in non-unique indices and retrieves all', async ({ getTyped }) => {
    const col = getTyped(db).getCollection<{ id: string; idx: number }>(getUniqueName(), {
      idx: {},
    });

    await col.add({ id: '1', idx: 8 }, { id: '2', idx: 8 }, { id: '3', idx: 10 });

    const retrieved = await fromAsync(col.where('idx', 8).values());
    expect(retrieved.length).toEqual(2);
    const retrievedIds = retrieved.map(({ id }) => id);
    expect(new Set(retrievedIds)).toEqual(new Set(['1', '2']));
  });

  it('rejects access after closing', async ({ getTyped }) => {
    const col = getTyped(db).getCollection<{ id: string; value: string }>(getUniqueName());
    await col.add({ id: '1', value: 'foo' });

    await getTyped(db).close();

    await expect(() => col.add({ id: '2', value: 'bar' })).throws('Connection closed');
  });

  it('survives immediate database closure', async ({ getTyped }) => {
    // create a complex collection which will often need database setup at construction time:
    const col = getTyped(db).getCollection<{ id: string; idx: number; value: string }>(
      getUniqueName(),
      { idx: {}, value: { unique: true } },
    );
    await getTyped(db).close(); // close before database setup has completed

    await expect(() => col.add({ id: '1', idx: 4, value: 'foo' })).throws('Connection closed');
  });

  it('duplicate close() calls resolve immediately', async ({ getTyped }) => {
    await getTyped(db).close();
    let resolved = false;
    getTyped(db)
      .close()
      .then(() => {
        resolved = true;
      });
    await Promise.resolve();
    expect(resolved).isTrue();
  });

  it('returns the same collection object for subsequent requests', async ({ getTyped }) => {
    const name = getUniqueName();
    const col1 = getTyped(db).getCollection(name);
    const col2 = getTyped(db).getCollection(name);

    expect(col2).toBe(col1);
  });

  it('rejects attempts to get the same collection with different key schemas', async ({
    getTyped,
  }) => {
    const name = getUniqueName();
    const keys1 = { idx: { unique: true } };
    const keys2 = { value: { unique: true } };
    getTyped(db).getCollection<TestType>(name, keys1);

    expect(() => getTyped(db).getCollection<TestType>(name, keys2)).throws();
  });

  it('allows distinct keys for the same collection if they are equivalent', async ({
    getTyped,
  }) => {
    const name = getUniqueName();
    const keys1 = { idx: { unique: true }, value: { unique: true } };
    const keys2 = { value: { unique: true }, idx: { unique: true } }; // same keys, different order
    const col1 = getTyped(db).getCollection<TestType>(name, keys1);
    const col2 = getTyped(db).getCollection<TestType>(name, keys2);

    expect(col2).toBe(col1);
  });

  describe('add', () => {
    it('rejects duplicate IDs', async ({ getTyped }) => {
      const col = getTyped(db).getCollection<{ id: string; value: string }>(getUniqueName());

      await col.add({ id: '2', value: 'bar' });
      await col.add({ id: '3', value: 'baz' });
      await expect(() => col.add({ id: '2', value: 'nope' })).throws('duplicate');
    });

    it('rejects duplicates in unique indices', async ({ getTyped }) => {
      const col = getTyped(db).getCollection<TestType>(getUniqueName(), {
        idx: { unique: true },
      });

      await col.add({ id: '1', idx: 8 });
      await col.add({ id: '2', idx: 9 });
      await expect(() => col.add({ id: '3', idx: 8 })).throws('duplicate');
    });
  });

  describe('where', () => {
    const col = withCollection(db, { idx: {} }, [{ id: '1', idx: 2, a: 'A1', b: 'B1' }]);

    it('rejects filters using unindexed keys', ({ getTyped }) => {
      expect(() => getTyped(col).where('b', 'B1')).throws('No index');
    });
  });

  describe('get', () => {
    const col = withCollection(db, { idx: {} }, [
      { id: '1', idx: 2, a: 'A1', b: 'B1' },
      { id: '2', idx: 3, a: 'A2', b: 'B2' },
    ]);

    it('returns only the requested attributes', async ({ getTyped }) => {
      const v = await getTyped(col).where('id', '1').attrs(['idx', 'b']).get();
      expect(v).toEqual({ idx: 2, b: 'B1' });
    });

    it('omits requested attributes which do not exist', async ({ getTyped }) => {
      const v = await getTyped(col)
        .where('id', '1')
        .attrs(['b', 'nope' as any])
        .get();
      expect(v).toEqual({ b: 'B1' });
    });

    it('returns the special ID attribute if requested', async ({ getTyped }) => {
      const v = await getTyped(col).where('id', '1').attrs(['id', 'b']).get();
      expect(v).toEqual({ id: '1', b: 'B1' });
    });

    it('returns all attributes by default', async ({ getTyped }) => {
      const v = await getTyped(col).where('id', '1').get();
      expect(v).toEqual({ id: '1', idx: 2, a: 'A1', b: 'B1' });
    });

    it('allows filters using any indexed attribute', async ({ getTyped }) => {
      const v = await getTyped(col).where('idx', 2).get();
      expect(v!.id).toEqual('1');
    });

    it('returns null if no values match', async ({ getTyped }) => {
      const v = await getTyped(col).where('idx', 4).get();
      expect(v).toEqual(null);
    });

    it('returns any value if no filter is specified', async ({ getTyped }) => {
      const v = await getTyped(col).all().get();
      expect(['1', '2']).contains(v?.id);
    });
  });

  describe('get unique', () => {
    const col = withCollection(db, { idx: { unique: true } }, [
      { id: '1', idx: 2, a: 'A1', b: 'B1' },
    ]);

    it('returns only the requested attributes', async ({ getTyped }) => {
      const v = await getTyped(col).where('idx', 2).attrs(['idx', 'b']).get();
      expect(v).toEqual({ idx: 2, b: 'B1' });
    });

    it('uses just the index if possible', async ({ getTyped }) => {
      const v = await getTyped(col).where('idx', 2).attrs(['idx', 'id']).get();
      expect(v).toEqual({ idx: 2, id: '1' });
    });

    it('returns all attributes by default', async ({ getTyped }) => {
      const v = await getTyped(col).where('idx', 2).get();
      expect(v).toEqual({ id: '1', idx: 2, a: 'A1', b: 'B1' });
    });
  });

  describe('get data types', () => {
    it('allows querying by JSON data', async ({ getTyped }) => {
      const value = { nested: ['hi', { object: 3 }] };
      const stored = { id: '1', value };
      const col = getTyped(db).getCollection<typeof stored>(getUniqueName(), {
        value: {},
      });

      await col.add(stored);

      const sameValue = { ...value };
      const otherValue = { nested: ['nah', { object: 3 }] };

      expect((await col.where('value', sameValue).get())!.id).toEqual('1');
      expect(await col.where('value', otherValue).get()).toBeNull();
    });

    it('allows querying by binary data', async ({ getTyped }) => {
      const value = Buffer.from('hello', 'utf8');
      const stored = { id: '1', value };
      const col = getTyped(db).getCollection<typeof stored>(getUniqueName(), {
        value: {},
      });

      await col.add(stored);

      const sameValue = Buffer.from(value);
      const otherValue = Buffer.from('nah', 'utf8');

      expect((await col.where('value', sameValue).get())!.id).toEqual('1');
      expect(await col.where('value', otherValue).get()).toBeNull();
    });
  });

  describe('values', () => {
    const col = withCollection(db, { idx: {} }, [
      { id: '1', idx: 1, a: 'A1', b: 'B1' },
      { id: '2', idx: 2, a: 'A2', b: 'B2' },
      { id: '3', idx: 2, a: 'A3', b: 'B3' },
    ]);

    it('returns only the requested attributes', async ({ getTyped }) => {
      const v = await fromAsync(getTyped(col).where('id', '1').attrs(['idx', 'b']).values());
      expect(v).toEqual([{ idx: 1, b: 'B1' }]);
    });

    it('returns all attributes by default', async ({ getTyped }) => {
      const v = await fromAsync(getTyped(col).where('id', '1').values());
      expect(v).toEqual([{ id: '1', idx: 1, a: 'A1', b: 'B1' }]);
    });

    it('allows filters using any indexed attribute', async ({ getTyped }) => {
      const v = await fromAsync(getTyped(col).where('idx', 2).values());
      expect(new Set(v)).toEqual(
        new Set([
          { id: '2', idx: 2, a: 'A2', b: 'B2' },
          { id: '3', idx: 2, a: 'A3', b: 'B3' },
        ]),
      );
    });

    it('returns an empty list if no values match', async ({ getTyped }) => {
      const v = await fromAsync(getTyped(col).where('idx', 3).values());
      expect(v).toEqual([]);
    });

    it('returns all values if no filter is specified', async ({ getTyped }) => {
      const v = await fromAsync(getTyped(col).all().values());
      expect(v.length).toEqual(3);
    });
  });

  describe('count', () => {
    const col = withCollection(db, { idx: {} }, [
      { id: '1', idx: 1, a: 'A1', b: 'B1' },
      { id: '2', idx: 2, a: 'A2', b: 'B2' },
      { id: '3', idx: 2, a: 'A3', b: 'B3' },
    ]);

    it('allows filters using any indexed attribute', async ({ getTyped }) => {
      await expect(getTyped(col).where('idx', 2).count()).resolves(2);
    });

    it('returns 0 if no values match', async ({ getTyped }) => {
      await expect(getTyped(col).where('idx', 3).count()).resolves(0);
    });

    it('returns the count of all items if no filter is specified', async ({ getTyped }) => {
      await expect(getTyped(col).all().count()).resolves(3);
    });
  });

  describe('update', () => {
    const col = withCollection(db, { idxs: {}, a: { unique: true } }, [
      { id: '1', idxs: '1', a: 'A1', b: 'B1' },
      { id: '2', idxs: '2', a: 'A2', b: 'B2' },
      { id: '3', idxs: '2', a: 'A3', b: 'B3' },
    ]);

    it('changes only matching entries', async ({ getTyped }) => {
      await getTyped(col).where('id', '2').update({ b: 'updated' });
      const [v1, v2, v3] = await Promise.all([
        getTyped(col).where('id', '1').get(),
        getTyped(col).where('id', '2').get(),
        getTyped(col).where('id', '3').get(),
      ]);
      expect(v1!.b).toEqual('B1');
      expect(v2!.b).toEqual('updated');
      expect(v3!.b).toEqual('B3');
    });

    it('rejects and rolls-back changes which cause duplicates', async ({ getTyped }) => {
      await expect(() => getTyped(col).where('id', '2').update({ a: 'A1' })).throws('duplicate');

      const v = await getTyped(col).where('id', '2').get();
      expect(v!.a).toEqual('A2');
    });

    it('allows setting unique columns to the same value', async ({ getTyped }) => {
      await getTyped(col).where('id', '2').update({ a: 'A2', b: 'updated' });

      const v = await getTyped(col).where('id', '2').get();
      expect(v!.a).toEqual('A2');
      expect(v!.b).toEqual('updated');
    });

    it('allows setting unique columns to historic values', async ({ getTyped }) => {
      await getTyped(col).where('id', '3').update({ a: 'A3b' });
      await getTyped(col).where('id', '2').update({ a: 'A3' });

      const v = await getTyped(col).where('id', '2').get();
      expect(v!.a).toEqual('A3');
    });

    it('rejects attempts to change the ID', async ({ getTyped }) => {
      await expect(() => getTyped(col).where('id', '2').update({ id: '4' })).throws(
        'Cannot update ID',
      );

      const v = await getTyped(col).where('id', '2').get();
      expect(v).toBeTruthy();
    });

    it('allows setting ID to the same value', async ({ getTyped }) => {
      await getTyped(col).where('id', '2').update({ id: '2', b: 'updated' });

      const v = await getTyped(col).where('id', '2').get();
      expect(v!.b).toEqual('updated');
    });

    it('allows setting ID to the same value via another property', async ({ getTyped }) => {
      await getTyped(col).where('a', 'A2').update({ id: '2', b: 'updated' });

      const v = await getTyped(col).where('id', '2').get();
      expect(v!.b).toEqual('updated');
    });

    it('rejects attempts to change the ID via another property and rolls back', async ({
      getTyped,
    }) => {
      await expect(() => getTyped(col).where('a', 'A2').update({ id: '4', b: 'new' })).throws(
        'Cannot update ID',
      );

      const v = await getTyped(col).where('id', '2').get();
      expect(v).toBeTruthy();
      expect(v!.b).toEqual('B2');
    });

    it('changes all matching entries', async ({ getTyped }) => {
      await getTyped(col).where('idxs', '2').update({ b: 'updated' });
      const [v2, v3] = await Promise.all([
        getTyped(col).where('id', '2').get(),
        getTyped(col).where('id', '3').get(),
      ]);
      expect(v2!.b).toEqual('updated');
      expect(v3!.b).toEqual('updated');
    });

    it('rejects conflicts from changing multiple records', async ({ getTyped }) => {
      await expect(() => getTyped(col).where('idxs', '2').update({ a: 'multi' })).throws(
        'duplicate',
      );
      const [v2, v3] = await Promise.all([
        getTyped(col).where('id', '2').get(),
        getTyped(col).where('id', '3').get(),
      ]);
      expect(v2!.a).toEqual('A2');
      expect(v3!.a).toEqual('A3');
    });

    it('leaves unspecified properties unchanged', async ({ getTyped }) => {
      await getTyped(col).where('id', '2').update({ b: 'updated' });
      const v = await getTyped(col).where('id', '2').get();
      expect(v!.a).toEqual('A2');
    });

    it('does nothing if no value matches', async ({ getTyped }) => {
      await getTyped(col).where('idxs', '10').update({ b: 'updated' });
      const [v1, v2, v3] = await Promise.all([
        getTyped(col).where('id', '1').get(),
        getTyped(col).where('id', '2').get(),
        getTyped(col).where('id', '3').get(),
      ]);
      expect(v1!.b).toEqual('B1');
      expect(v2!.b).toEqual('B2');
      expect(v3!.b).toEqual('B3');
      expect(await getTyped(col).all().count()).toEqual(3);
    });

    it('rejects attempts to update without a filter', async ({ getTyped }) => {
      await expect(() => getTyped(col).all().update({ b: 'updated' })).throws(
        'Cannot apply update to all items',
      );
    });

    describe('upsert', () => {
      it('updates existing records if found by ID', async ({ getTyped }) => {
        await getTyped(col).where('id', '2').update({ b: 'updated' }, { upsert: true });

        const v = await getTyped(col).where('id', '2').get();
        expect(v!.b).toEqual('updated');
        expect(await getTyped(col).all().count()).toEqual(3);
      });

      it('preserves unmodified values when updating', async ({ getTyped }) => {
        await getTyped(col).where('id', '2').update({ b: 'updated' }, { upsert: true });

        const v = await getTyped(col).where('id', '2').get();
        expect(v!.a).toEqual('A2');
      });

      it('adds a new record if no value matches using key ID', async ({ getTyped }) => {
        const data = { idxs: 'x', a: 'y', b: 'z' };
        await getTyped(col).where('id', '4').update(data, { upsert: true });
        expect(await getTyped(col).all().count()).toEqual(4);
      });

      it('rejects attempts to upsert using a non-ID index', async ({ getTyped }) => {
        const data = { id: '6', idxs: 'w', a: 'y', b: 'z' };
        await expect(() => getTyped(col).where('a', 'x').update(data, { upsert: true })).throws(
          'Can only upsert by ID',
        );
        expect(await getTyped(col).all().count()).toEqual(3);
      });

      it('rejects attempts to upsert without a filter', async ({ getTyped }) => {
        const data = { id: '6', idxs: 'w', a: 'y', b: 'z' };
        await expect(() => getTyped(col).all().update(data, { upsert: true })).throws(
          'Cannot apply update to all items',
        );
        expect(await getTyped(col).all().count()).toEqual(3);
      });

      it('rejects duplicates if no value matches', async ({ getTyped }) => {
        await expect(() =>
          getTyped(col).where('id', '6').update({ a: 'A2' }, { upsert: true }),
        ).throws('duplicate');
        expect(await getTyped(col).all().count()).toEqual(3);
      });
    });
  });

  describe('remove', () => {
    const col = withCollection(db, { idxs: {} }, [
      { id: '1', idxs: '1' },
      { id: '2', idxs: '2' },
      { id: '3', idxs: '2', b: 'B2' },
    ]);

    it('removes items from the collection', async ({ getTyped }) => {
      await getTyped(col).where('id', '2').remove();

      expect(new Set(await fromAsync(getTyped(col).all().values()))).toEqual(
        new Set([
          { id: '1', idxs: '1' },
          { id: '3', idxs: '2', b: 'B2' },
        ]),
      );
    });

    it('removes all items matching the query', async ({ getTyped }) => {
      await getTyped(col).where('idxs', '2').remove();

      expect(new Set(await fromAsync(getTyped(col).all().values()))).toEqual(
        new Set([{ id: '1', idxs: '1' }]),
      );
    });

    it('returns the number of items removed', async ({ getTyped }) => {
      const count = await getTyped(col).where('idxs', '2').remove();
      expect(count).toEqual(2);
    });

    it('returns 0 if no values match for ID', async ({ getTyped }) => {
      const count = await getTyped(col).where('id', 'no').remove();
      expect(count).toEqual(0);

      expect(await getTyped(col).all().count()).toEqual(3);
    });

    it('returns 0 if no values match for field', async ({ getTyped }) => {
      const count = await getTyped(col).where('idxs', '10').remove();
      expect(count).toEqual(0);

      expect(await getTyped(col).all().count()).toEqual(3);
    });

    it('removes all values if no filter is specified', async ({ getTyped }) => {
      const count = await getTyped(col).all().remove();
      expect(count).toEqual(3);

      expect(await getTyped(col).all().count()).toEqual(0);
    });
  });

  describe('single-threaded concurrency', () => {
    const concurrency = 32;

    describe('update', () => {
      it(
        'does not clobber other thread changes',
        async ({ getTyped }) => {
          const c = getTyped(db).getCollection<any>(getUniqueName());
          const expected: any = { id: '1' };
          const tasks = [];
          for (let i = 0; i < concurrency; ++i) {
            const attr = `v${i}`;
            expected[attr] = 9;

            tasks.push(async () => {
              for (let n = 0; n < 10; ++n) {
                await c.where('id', '1').update({ [attr]: n });
              }
            });
          }
          await c.add({ id: '1' });

          await runAll(tasks.map((t) => t()));

          expect(await c.where('id', '1').get()).toEqual(expected);
        },
        { timeout: 20000 },
      );

      it('allows the first entry to upsert', async ({ getTyped }) => {
        const c = getTyped(db).getCollection<any>(getUniqueName());
        const expected: any = { id: '1' };
        const tasks = [];
        for (let i = 0; i < concurrency; ++i) {
          const attr = `v${i}`;
          expected[attr] = 1;

          tasks.push(async () => {
            await c.where('id', '1').update({ [attr]: 1 }, { upsert: true });
          });
        }

        await runAll(tasks.map((t) => t()));

        expect(await c.where('id', '1').get()).toEqual(expected);
      });
    });
  });

  describe(
    'security',
    () => {
      it('is allowed in collection names', async ({ getTyped }, { value, excludeStructure }) => {
        assume(excludeStructure).isFalsy();

        const col = getTyped(db).getCollection<{ id: string; value: string }>(value);

        await col.add({ id: '1', value: 'foo' });
        expect(await col.where('id', '1').get()).toEqual({ id: '1', value: 'foo' });

        await col.where('id', '1').update({ value: 'bar' });
        expect(await col.where('id', '1').get()).toEqual({ id: '1', value: 'bar' });

        await col.where('id', '2').update({ value: 'wee' }, { upsert: true });
        expect(await col.where('id', '2').get()).toEqual({ id: '2', value: 'wee' });

        await col.where('id', '2').update({ value: 'woo' }, { upsert: true });
        expect(await col.where('id', '2').get()).toEqual({ id: '2', value: 'woo' });
      });

      it('is allowed in attribute names', async ({ getTyped }, {
        value,
        excludeAttributeName,
        allowRejection,
      }) => {
        assume(excludeAttributeName).isFalsy();

        const col2 = getTyped(db).getCollection<any>(getUniqueName());

        // Basic add, get, partial get
        try {
          await col2.add(
            Object.fromEntries([
              ['id', '1'],
              [value, 'foo'],
            ]),
          );
        } catch (err) {
          if (allowRejection) {
            return; // rejection is accepted as a pass
          }
          throw err;
        }

        const retrieved = await col2.where('id', '1').get();
        expect(retrieved).toBeTruthy();
        expect(retrieved!['id']).toEqual('1');
        expect(retrieved![value]).toEqual('foo');

        const retrievedPart = await col2.where('id', '1').attrs(['id', value]).get();
        expect(retrievedPart).toBeTruthy();
        expect(retrievedPart!['id']).toEqual('1');
        expect(retrievedPart![value]).toEqual('foo');

        // Update
        await col2.where('id', '1').update(Object.fromEntries([[value, 'bar']]));

        const retrievedUpdated = await col2.where('id', '1').get();
        expect(retrievedUpdated![value]).toEqual('bar');

        // Upsert
        await col2.where('id', '2').update(Object.fromEntries([[value, 'wee']]), { upsert: true });

        const retrievedUpserted = await col2.where('id', '2').get();
        expect(retrievedUpserted![value]).toEqual('wee');

        await col2.where('id', '2').update(Object.fromEntries([[value, 'woo']]), { upsert: true });

        const retrievedUpserted2 = await col2.where('id', '2').get();
        expect(retrievedUpserted2![value]).toEqual('woo');

        // Add without field
        await col2.add({ id: '3' });

        const retrievedWithout = await col2.where('id', '3').get();
        expect(retrievedWithout!['id']).toEqual('3');
        expect(Object.prototype.hasOwnProperty.call(retrievedWithout, value)).toBeFalsy();

        expect(retrievedWithout!.constructor).toBe(Object);
        expect(retrievedWithout!['__proto__']).toBe(Object.prototype);
        expect(retrievedWithout!.hasOwnProperty).toBe(Object.prototype.hasOwnProperty);

        // Malicious add
        await col2.add(
          Object.fromEntries([
            ['id', '4'],
            [value, { attack: 'eep' }],
          ]),
        );
        const retrievedMalicious = await col2.where('id', '4').get();
        expect(retrievedMalicious!['attack']).toBeUndefined();
        expect(({} as any).attack).toBeUndefined();
      });

      it('is allowed in values', async ({ getTyped }, { value, allowRejection }) => {
        const col2 = getTyped(db).getCollection<any>(getUniqueName());

        // Basic add, get, partial get
        try {
          await col2.add({ id: '1', value });
        } catch (err) {
          if (allowRejection) {
            return; // rejection is accepted as a pass
          }
          throw err;
        }

        const retrieved = await col2.where('id', '1').get();
        expect(retrieved).toBeTruthy();
        expect(retrieved!['value']).toEqual(value);

        const retrievedPart = await col2.where('id', '1').attrs(['value']).get();
        expect(retrievedPart).toBeTruthy();
        expect(retrievedPart!['value']).toEqual(value);

        // Update
        await col2.where('id', '1').update({ value2: value });

        const retrievedUpdated = await col2.where('id', '1').get();
        expect(retrievedUpdated!['value2']).toEqual(value);
      });

      it('is allowed in object keys in values', async ({ getTyped }, { value, allowRejection }) => {
        const col2 = getTyped(db).getCollection<any>(getUniqueName());

        // Basic add, get, partial get
        try {
          await col2.add({ id: '1', value: Object.fromEntries([[value, 'foo']]) });
        } catch (err) {
          if (allowRejection) {
            return; // rejection is accepted as a pass
          }
          throw err;
        }

        const retrieved = await col2.where('id', '1').get();
        expect(retrieved).toBeTruthy();
        expect(retrieved!['value'][value]).toEqual('foo');

        const retrievedPart = await col2.where('id', '1').attrs(['value']).get();
        expect(retrievedPart).toBeTruthy();
        expect(retrievedPart!['value'][value]).toEqual('foo');

        // Update
        await col2.where('id', '1').update({ value: Object.fromEntries([[value, 'bar']]) });

        const retrievedUpdated = await col2.where('id', '1').get();
        expect(retrievedUpdated!['value'][value]).toEqual('bar');

        // Malicious add
        await col2.add({ id: '2', value: Object.fromEntries([[value, { attack: 'eep' }]]) });
        const retrievedMalicious = await col2.where('id', '2').get();
        expect(retrievedMalicious!['value'].attack).toBeUndefined();
        expect(({} as any).attack).toBeUndefined();
      });

      it('is allowed in indices', async ({ getTyped }, { value, excludeStructure }) => {
        assume(excludeStructure).isFalsy();

        const col2 = getTyped(db).getCollection<any>(
          getUniqueName(),
          Object.fromEntries([[value, { unique: true }]]),
        );

        // Basic add, get
        await col2.add(
          Object.fromEntries([
            ['id', '1'],
            [value, 'foo'],
          ]),
        );

        const retrieved = await col2.where(value, 'foo').get();
        expect(retrieved).toBeTruthy();
        expect(retrieved!['id']).toEqual('1');
        expect(retrieved![value]).toEqual('foo');

        // Update by id, attribute
        await col2.where('id', '1').update(Object.fromEntries([[value, 'bar']]));

        const retrievedUpdated = await col2.where('id', '1').get();
        expect(retrievedUpdated![value]).toEqual('bar');

        await col2.where(value, 'bar').update(Object.fromEntries([[value, 'baz']]));

        const retrievedUpdated2 = await col2.where('id', '1').get();
        expect(retrievedUpdated2![value]).toEqual('baz');

        // Upsert
        await col2.where('id', '2').update(Object.fromEntries([[value, 'wee']]), { upsert: true });

        const retrievedUpserted = await col2.where('id', '2').get();
        expect(retrievedUpserted![value]).toEqual('wee');

        await col2.where('id', '2').update(Object.fromEntries([[value, 'woo']]), { upsert: true });

        const retrievedUpserted2 = await col2.where('id', '2').get();
        expect(retrievedUpserted2![value]).toEqual('woo');
      });
    },
    {
      parameters: [
        { name: 'special characters - brackets', value: '<a>b(c)d[e]f{g}' },
        { name: 'special characters - quotes', value: 'test\'a"b' },
        { name: 'special characters - backslash', value: 'test\\a\\' },
        { name: 'special characters - punctuation', value: 'a-b_c+d=e&f$g!h:i;j?k,l.m%n' },
        { name: 'leading underscore', value: '_foo' },
        { name: 'function-like string', value: '$or' },
        {
          name: 'function-like object',
          value: { $or: ['a'] },
          excludeStructure: true,
          excludeAttributeName: true,
        },
        { name: 'json-like', value: '"foo"' },
        { name: 'hstore-like', value: '"a"=>"b"' },
        { name: 'json-path-like', value: '$.foo' },
        { name: 'malicious (__proto__)', value: '__proto__' },
        { name: 'malicious (constructor)', value: 'constructor' },
        { name: 'malicious (hasOwnProperty)', value: 'hasOwnProperty' },
        { name: 'null', value: 'a\x00b', excludeStructure: true, allowRejection: true },
      ],
    },
  );

  describe('data migration', { ignore: !testMigration }, () => {
    const dbBefore = beforeEach<T>(async ({ setParameter, getTyped }) => {
      const dbBefore = await migrationFactory(getTyped(db));
      setParameter(dbBefore);
      return () => dbBefore.close();
    });

    const colBefore = withCollection(dbBefore, { idx: {}, value: { unique: true } }, [
      { id: '1', idx: 1, value: 'v1', a: 'a1', b: 'b1' },
      { id: '2', idx: 2, value: 'v2', a: 'a2', b: 'b2' },
      { id: '3', idx: 3, value: 'v3', a: 'a2', b: 'b3' },
    ]);

    it('adds indices', async ({ getTyped }) => {
      const col = getTyped(db).getCollection<TestType>(getTyped(colBefore).name, {
        idx: {},
        value: { unique: true },
        idxs: {},
      });

      await col.add({
        id: '4',
        idx: 4,
        value: 'v4',
        a: 'a4',
        b: 'b4',
        idxs: 's4',
      });

      expect(new Set(await fromAsync(col.where('idxs', 's4').values()))).toEqual(
        new Set([{ id: '4', idx: 4, value: 'v4', a: 'a4', b: 'b4', idxs: 's4' }]),
      );
    });

    it('adds indices with existing data', async ({ getTyped }) => {
      const col = getTyped(db).getCollection<TestType>(getTyped(colBefore).name, {
        idx: {},
        value: { unique: true },
        a: {},
      });

      await col.add({ id: '4', idx: 4, value: 'v4', a: 'a1', b: 'b4' });

      expect(new Set(await fromAsync(col.where('a', 'a2').values()))).toEqual(
        new Set([
          { id: '2', idx: 2, value: 'v2', a: 'a2', b: 'b2' },
          { id: '3', idx: 3, value: 'v3', a: 'a2', b: 'b3' },
        ]),
      );
    });

    it('adds unique indices with existing data', async ({ getTyped }) => {
      const col = getTyped(db).getCollection<TestType>(getTyped(colBefore).name, {
        idx: {},
        value: { unique: true },
        b: { unique: true },
      });

      await expect(() => col.add({ id: '4', idx: 4, value: 'v4', a: 'a4', b: 'b3' })).throws(
        'duplicate',
      );

      expect(new Set(await fromAsync(col.where('b', 'b2').values()))).toEqual(
        new Set([{ id: '2', idx: 2, value: 'v2', a: 'a2', b: 'b2' }]),
      );
    });

    it('adds uniqueness to existing indices', async ({ getTyped }) => {
      const col = getTyped(db).getCollection<TestType>(getTyped(colBefore).name, {
        idx: { unique: true },
        value: { unique: true },
      });

      await expect(() => col.add({ id: '4', idx: 3, value: 'v4', a: 'a4', b: 'b4' })).throws(
        'duplicate',
      );

      expect(new Set(await fromAsync(col.where('idx', 2).values()))).toEqual(
        new Set([{ id: '2', idx: 2, value: 'v2', a: 'a2', b: 'b2' }]),
      );
    });

    it('throws if duplicate values exist when adding uniqueness', async ({ getTyped }) => {
      await getTyped(colBefore).add({ id: '4', idx: 3, value: 'v4', a: 'a4', b: 'b4' });

      // exception may be asynchronous, so not seen until first operation:
      await expect(async () => {
        const col = getTyped(db).getCollection<TestType>(getTyped(colBefore).name, {
          idx: { unique: true },
          value: { unique: true },
        });
        await col.all().count();
      }).throws();
    });

    it('removes uniqueness from existing indices', async ({ getTyped }) => {
      const col = getTyped(db).getCollection<TestType>(getTyped(colBefore).name, {
        idx: {},
        value: {},
      });

      await col.add({ id: '4', idx: 4, value: 'v3', a: 'a4', b: 'b4' });

      expect(new Set(await fromAsync(col.where('value', 'v3').values()))).toEqual(
        new Set([
          { id: '3', idx: 3, value: 'v3', a: 'a2', b: 'b3' },
          { id: '4', idx: 4, value: 'v3', a: 'a4', b: 'b4' },
        ]),
      );
    });

    it('removes indices', async ({ getTyped }) => {
      const col = getTyped(db).getCollection<TestType>(getTyped(colBefore).name, {
        value: { unique: true },
      });

      await expect(() => col.where('idx', 1)).throws('No index for idx');
    });

    it('removes unique indices', async ({ getTyped }) => {
      const col = getTyped(db).getCollection<TestType>(getTyped(colBefore).name, { idx: {} });

      await col.add({ id: '4', idx: 4, value: 'v3', a: 'a4', b: 'b4' });

      await expect(() => col.where('value', 'v2')).throws('No index for value');
    });
  });

  return { db };
};

interface TestType {
  id: string;
  idx?: number;
  idxs?: string;
  value?: string;
  a?: string;
  b?: string;
}

export function withDB<T extends DB>(factory: () => Promise<T> | T) {
  return beforeEach<T>(async ({ setParameter }) => {
    const db = await factory();
    setParameter(db);
    return () => db.close();
  });
}

export function withCollection<T extends IDable>(
  db: TypedParameter<DB>,
  keys: DBKeys<T>,
  initialData: T[],
) {
  return beforeEach<Collection<T>>(async ({ getTyped, setParameter }) => {
    const col = getTyped(db).getCollection(getUniqueName(), keys);
    setParameter(col);
    await col.add(...initialData);
  });
}

async function runAll<T>(promises: Promise<T>[]) {
  const results = await Promise.allSettled(promises);

  const failures = results.filter((r) => r.status === 'rejected');
  if (failures.length > 0) {
    const description = failures.map((r) => r.reason).join(', ');
    throw new Error(`Parallel tasks failed: ${description}`);
  }
}

function getUniqueName() {
  const time = Date.now().toFixed(0);
  const random = Math.random().toFixed(8).substring(2);
  return `test-${time.substring(time.length - 7)}${random}`;
}

// this can be swapped for Array.fromAsync once Node.js 20.x is out of support
export async function fromAsync<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const r: T[] = [];
  for await (const item of iterable) {
    r.push(item);
  }
  return r;
}
