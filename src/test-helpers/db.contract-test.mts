import type { TypedParameter, TypedParameters } from 'lean-test';
import type { DB, DBKeys } from '../core/interfaces/DB.mts';
import type { Collection } from '../core/interfaces/Collection.mts';
import type { IDable } from '../core/interfaces/IDable.mts';
import { DuplicateError } from '../core/DuplicateError.mts';
import 'lean-test';

const vanillaIt = it;

export const contract = <T extends DB>({
  factory,
  testWrapper, // like beforeEach, but runs after any test prep has completed
}: {
  factory: () => Promise<T> | T;
  testWrapper?: (options: TypedParameters & { db: T }) => (() => void) | void;
}) => {
  const db = withDB(factory);

  const it = async (
    name: string,
    fn: (options: TypedParameters & { db: T }, ...args: any[]) => Promise<void> | void,
    options?: { timeout?: number; parameters?: any[] },
  ) => {
    vanillaIt(name, { timeout: 5000, ...options }, async (options, ...rest) => {
      const augmentedOptions = { ...options, db: options.getTyped(db) };
      const teardown = testWrapper?.(augmentedOptions);
      await fn(augmentedOptions, ...rest);
      teardown?.();
    });
  };

  // a shared collection without any indices - used by tests that don't mind sharing
  // (avoids excess load on Mongo due to large numbers of tables, which can cause crashes due to file handle exhaustion)
  const sharedColName = getUniqueName();
  const sharedCol = (db: DB) =>
    db.getCollection<{ id: string; value?: any } & Record<string, any>>(sharedColName);

  it(
    'stores and retrieves data',
    async ({ getTyped }, { value }) => {
      const col = sharedCol(getTyped(db));

      const stored = { id: getUniqueName(), value };
      await col.add(stored);

      const retrieved = await col.where('id', stored.id).get();

      expect(retrieved).toEqual(stored);
      expect(retrieved).not(toBe(stored));
    },
    {
      parameters: [
        { name: 'string', value: 'foo' },
        { name: 'JSON data', value: { nested: ['hi', { object: 3 }] } },
        { name: 'numeric', value: 123 },
        { name: 'zero', value: 0 },
        { name: 'null', value: null },
        { name: 'true', value: true },
        { name: 'false', value: false },
      ],
    },
  );

  it('stores and retrieves binary data', async ({ getTyped }) => {
    const col = sharedCol(getTyped(db));

    const stored = { id: getUniqueName(), value: Buffer.from('hello', 'utf8') };
    await col.add(stored);

    const retrieved = await col.where('id', stored.id).get();

    expect(retrieved!.value).toBeInstanceOf(Buffer);
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

    await col.removeAllAndDestroy();
  });

  it('rejects access after closing', async ({ getTyped }) => {
    const col = sharedCol(getTyped(db));
    await col.add({ id: getUniqueName(), value: 'foo' });

    await getTyped(db).close();

    await expect(() => col.add({ id: getUniqueName(), value: 'bar' })).throws('Connection closed');
  });

  it('survives immediate database closure', async ({ getTyped }) => {
    // create a complex collection which will often need database setup at construction time:
    const col = getTyped(db).getCollection<{ id: string; idx: number; uidx: string }>(
      getUniqueName(),
      { idx: {}, uidx: { unique: true } },
    );
    await getTyped(db).close(); // close before database setup has completed

    await expect(() => col.add({ id: '1', idx: 4, uidx: 'foo' })).throws('Connection closed');
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
    const col1 = sharedCol(getTyped(db));
    const col2 = sharedCol(getTyped(db));

    expect(col2).toBe(col1);
  });

  it('rejects attempts to get the same collection with different key schemas', async ({
    getTyped,
  }) => {
    const name = getUniqueName();
    const keys1 = { idx: { unique: true } };
    const keys2 = { value: { unique: true } };
    const col = getTyped(db).getCollection<TestType>(name, keys1);

    expect(() => getTyped(db).getCollection<TestType>(name, keys2)).throws();

    await col.removeAllAndDestroy();
  });

  it('allows distinct keys for the same collection if they are equivalent', async ({
    getTyped,
  }) => {
    const name = getUniqueName();
    const keys1 = { idx: { unique: true }, uidx: { unique: true } };
    const keys2 = { uidx: { unique: true }, idx: { unique: true } }; // same keys, different order
    const col1 = getTyped(db).getCollection<TestType>(name, keys1);
    const col2 = getTyped(db).getCollection<TestType>(name, keys2);

    expect(col2).toBe(col1);

    await col1.removeAllAndDestroy();
  });

  describe('add', () => {
    it('rejects duplicate IDs', async ({ getTyped }) => {
      const col = sharedCol(getTyped(db));

      const id1 = getUniqueName();
      const id2 = getUniqueName();
      await col.add({ id: id1, value: 'bar' });
      await col.add({ id: id2, value: 'baz' });
      await expect(() => col.add({ id: id1, value: 'nope' })).throws(isInstanceOf(DuplicateError));
    });

    it('rejects duplicates in unique indices', async ({ getTyped }) => {
      const col = getTyped(db).getCollection<TestType>(getUniqueName(), {
        idx: { unique: true },
      });

      await col.add({ id: '1', idx: 8 });
      await col.add({ id: '2', idx: 9 });
      await expect(() => col.add({ id: '3', idx: 8 })).throws(isInstanceOf(DuplicateError));

      await col.removeAllAndDestroy();
    });
  });

  describe('where', () => {
    const col = withCollection(db, {
      keys: { idx: {} },
      seed: [{ id: '1', idx: 2, other: 'B1' }],
    });

    it('rejects filters using unindexed keys', ({ getTyped }) => {
      expect(() => getTyped(col).where('other', 'B1')).throws('No index');
    });
  });

  describe('get', () => {
    const col = withCollection(db, {
      keys: { idx: {} },
      seed: [
        { id: '1', idx: 2, value: 'A1', b: 'B1' },
        { id: '2', idx: 3, value: 'A2', b: 'B2' },
      ],
    });

    it('returns only the requested attributes', async ({ getTyped }) => {
      const v = await getTyped(col).where('id', '1').attrs(['idx', 'value']).get();
      expect(v).toEqual({ idx: 2, value: 'A1' });
    });

    it('omits requested attributes which do not exist', async ({ getTyped }) => {
      const v = await getTyped(col)
        .where('id', '1')
        .attrs(['b', 'nope' as any])
        .get();
      expect(v).toEqual({ b: 'B1' });
    });

    it('returns the special ID attribute if requested', async ({ getTyped }) => {
      const v = await getTyped(col).where('id', '1').attrs(['id', 'value']).get();
      expect(v).toEqual({ id: '1', value: 'A1' });
    });

    it('returns all attributes by default', async ({ getTyped }) => {
      const v = await getTyped(col).where('id', '1').get();
      expect(v).toEqual({ id: '1', idx: 2, value: 'A1', b: 'B1' });
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
    const col = withCollection(db, {
      keys: { idx: { unique: true } },
      seed: [{ id: '1', idx: 2, value: 'A1', b: 'B1' }],
    });

    it('returns only the requested attributes', async ({ getTyped }) => {
      const v = await getTyped(col).where('idx', 2).attrs(['idx', 'value']).get();
      expect(v).toEqual({ idx: 2, value: 'A1' });
    });

    it('uses just the index if possible', async ({ getTyped }) => {
      // this test is relevant to DynamoDB, where idx and id are available in the index and do not need a data table lookup
      const v = await getTyped(col).where('idx', 2).attrs(['idx', 'id']).get();
      expect(v).toEqual({ idx: 2, id: '1' });
    });

    it('returns all attributes by default', async ({ getTyped }) => {
      const v = await getTyped(col).where('idx', 2).get();
      expect(v).toEqual({ id: '1', idx: 2, value: 'A1', b: 'B1' });
    });
  });

  describe('get data types', () => {
    it('allows querying by JSON data', async ({ getTyped }) => {
      const value = { nested: ['hi', { object: 3 }] };
      const stored = { id: '1', json: value };
      const col = getTyped(db).getCollection<typeof stored>(getUniqueName(), {
        json: {},
      });

      await col.add(stored);

      const sameValue = { ...value };
      const otherValue = { nested: ['nah', { object: 3 }] };

      expect((await col.where('json', sameValue).get())!.id).toEqual('1');
      expect(await col.where('json', otherValue).get()).toBeNull();

      await col.removeAllAndDestroy();
    });

    it('allows querying by binary data', async ({ getTyped }) => {
      const value = Buffer.from('hello', 'utf8');
      const stored = { id: '1', bin: value };
      const col = getTyped(db).getCollection<typeof stored>(getUniqueName(), {
        bin: {},
      });

      await col.add(stored);

      const sameValue = Buffer.from(value);
      const otherValue = Buffer.from('nah', 'utf8');

      expect((await col.where('bin', sameValue).get())!.id).toEqual('1');
      expect(await col.where('bin', otherValue).get()).toBeNull();

      await col.removeAllAndDestroy();
    });
  });

  describe('values', () => {
    const col = withCollection(db, {
      keys: { idx: {} },
      seed: [
        { id: '1', idx: 1, value: 'A1', b: 'B1' },
        { id: '2', idx: 2, value: 'A2', b: 'B2' },
        { id: '3', idx: 2, value: 'A3', b: 'B3' },
      ],
    });

    it('returns only the requested attributes', async ({ getTyped }) => {
      const v = await fromAsync(getTyped(col).where('id', '1').attrs(['idx', 'value']).values());
      expect(v).toEqual([{ idx: 1, value: 'A1' }]);
    });

    it('returns all attributes by default', async ({ getTyped }) => {
      const v = await fromAsync(getTyped(col).where('id', '1').values());
      expect(v).toEqual([{ id: '1', idx: 1, value: 'A1', b: 'B1' }]);
    });

    it('allows filters using any indexed attribute', async ({ getTyped }) => {
      const v = await fromAsync(getTyped(col).where('idx', 2).values());
      expect(new Set(v)).toEqual(
        new Set([
          { id: '2', idx: 2, value: 'A2', b: 'B2' },
          { id: '3', idx: 2, value: 'A3', b: 'B3' },
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
    const col = withCollection(db, {
      keys: { idx: {} },
      seed: [
        { id: '1', idx: 1, value: 'A1', b: 'B1' },
        { id: '2', idx: 2, value: 'A2', b: 'B2' },
        { id: '3', idx: 2, value: 'A3', b: 'B3' },
      ],
    });

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
    const col = withCollection(db, {
      keys: { idxs: {}, uidx: { unique: true } },
      seed: [
        { id: '1', idxs: '1', uidx: 'A1', value: 'B1' },
        { id: '2', idxs: '2', uidx: 'A2', value: 'B2' },
        { id: '3', idxs: '2', uidx: 'A3', value: 'B3' },
      ],
    });

    it('changes only matching entries', async ({ getTyped }) => {
      await getTyped(col).where('id', '2').update({ value: 'updated' });
      const [v1, v2, v3] = await Promise.all([
        getTyped(col).where('id', '1').get(),
        getTyped(col).where('id', '2').get(),
        getTyped(col).where('id', '3').get(),
      ]);
      expect(v1!.value).toEqual('B1');
      expect(v2!.value).toEqual('updated');
      expect(v3!.value).toEqual('B3');
    });

    it('rejects and rolls-back changes which cause duplicates', async ({ getTyped }) => {
      await expect(() => getTyped(col).where('id', '2').update({ uidx: 'A1' })).throws(
        isInstanceOf(DuplicateError),
      );

      const v = await getTyped(col).where('id', '2').get();
      expect(v!.uidx).toEqual('A2');
    });

    it('allows setting unique columns to the same value', async ({ getTyped }) => {
      await getTyped(col).where('id', '2').update({ uidx: 'A2', value: 'updated' });

      const v = await getTyped(col).where('id', '2').get();
      expect(v!.uidx).toEqual('A2');
      expect(v!.value).toEqual('updated');
    });

    it('allows setting unique columns to historic values', async ({ getTyped }) => {
      await getTyped(col).where('id', '3').update({ uidx: 'A3b' });
      await getTyped(col).where('id', '2').update({ uidx: 'A3' });

      const v = await getTyped(col).where('id', '2').get();
      expect(v!.uidx).toEqual('A3');
    });

    it('rejects attempts to change the ID', async ({ getTyped }) => {
      await expect(() => getTyped(col).where('id', '2').update({ id: '4' })).throws(
        'Cannot update ID',
      );

      const v = await getTyped(col).where('id', '2').get();
      expect(v).toBeTruthy();
    });

    it('allows setting ID to the same value', async ({ getTyped }) => {
      await getTyped(col).where('id', '2').update({ id: '2', value: 'updated' });

      const v = await getTyped(col).where('id', '2').get();
      expect(v!.value).toEqual('updated');
    });

    it('allows setting ID to the same value via another property', async ({ getTyped }) => {
      await getTyped(col).where('uidx', 'A2').update({ id: '2', value: 'updated' });

      const v = await getTyped(col).where('id', '2').get();
      expect(v!.value).toEqual('updated');
    });

    it('rejects attempts to change the ID via another property and rolls back', async ({
      getTyped,
    }) => {
      await expect(() =>
        getTyped(col).where('uidx', 'A2').update({ id: '4', value: 'new' }),
      ).throws('Cannot update ID');

      const v = await getTyped(col).where('id', '2').get();
      expect(v).toBeTruthy();
      expect(v!.value).toEqual('B2');
    });

    it('changes all matching entries', async ({ getTyped }) => {
      await getTyped(col).where('idxs', '2').update({ value: 'updated' });
      const [v2, v3] = await Promise.all([
        getTyped(col).where('id', '2').get(),
        getTyped(col).where('id', '3').get(),
      ]);
      expect(v2!.value).toEqual('updated');
      expect(v3!.value).toEqual('updated');
    });

    it('rejects conflicts from changing multiple records', async ({ getTyped }) => {
      await expect(() => getTyped(col).where('idxs', '2').update({ uidx: 'multi' })).throws(
        'Updating multiple records will create duplicates',
      );
      const [v2, v3] = await Promise.all([
        getTyped(col).where('id', '2').get(),
        getTyped(col).where('id', '3').get(),
      ]);
      expect(v2!.uidx).toEqual('A2');
      expect(v3!.uidx).toEqual('A3');
    });

    it('leaves unspecified properties unchanged', async ({ getTyped }) => {
      await getTyped(col).where('id', '2').update({ value: 'updated' });
      const v = await getTyped(col).where('id', '2').get();
      expect(v!.uidx).toEqual('A2');
    });

    it('does nothing if no value matches', async ({ getTyped }) => {
      await getTyped(col).where('idxs', '10').update({ value: 'updated' });
      const [v1, v2, v3] = await Promise.all([
        getTyped(col).where('id', '1').get(),
        getTyped(col).where('id', '2').get(),
        getTyped(col).where('id', '3').get(),
      ]);
      expect(v1!.value).toEqual('B1');
      expect(v2!.value).toEqual('B2');
      expect(v3!.value).toEqual('B3');
      expect(await getTyped(col).all().count()).toEqual(3);
    });

    it('rejects attempts to update without a filter', async ({ getTyped }) => {
      await expect(() => getTyped(col).all().update({ value: 'updated' })).throws(
        'Cannot apply update to all records',
      );
    });

    describe('upsert', () => {
      it('updates existing records if found by ID', async ({ getTyped }) => {
        await getTyped(col).where('id', '2').update({ value: 'updated' }, { upsert: true });

        const v = await getTyped(col).where('id', '2').get();
        expect(v!.value).toEqual('updated');
        expect(await getTyped(col).all().count()).toEqual(3);
      });

      it('preserves unmodified values when updating', async ({ getTyped }) => {
        await getTyped(col).where('id', '2').update({ value: 'updated' }, { upsert: true });

        const v = await getTyped(col).where('id', '2').get();
        expect(v!.uidx).toEqual('A2');
      });

      it('adds a new record if no value matches using key ID', async ({ getTyped }) => {
        const data = { idxs: 'x', uidx: 'y', b: 'z' };
        await getTyped(col).where('id', '4').update(data, { upsert: true });
        expect(await getTyped(col).all().count()).toEqual(4);
      });

      it('rejects attempts to upsert using a non-ID index', async ({ getTyped }) => {
        const data = { id: '6', idxs: 'w', uidx: 'y', b: 'z' };
        await expect(() => getTyped(col).where('uidx', 'x').update(data, { upsert: true })).throws(
          'Can only upsert by ID',
        );
        expect(await getTyped(col).all().count()).toEqual(3);
      });

      it('rejects attempts to upsert without a filter', async ({ getTyped }) => {
        const data = { id: '6', idxs: 'w', uidx: 'y', b: 'z' };
        await expect(() => getTyped(col).all().update(data, { upsert: true })).throws(
          'Cannot apply update to all records',
        );
        expect(await getTyped(col).all().count()).toEqual(3);
      });

      it('rejects duplicates if no value matches', async ({ getTyped }) => {
        await expect(() =>
          getTyped(col).where('id', '6').update({ uidx: 'A2' }, { upsert: true }),
        ).throws(isInstanceOf(DuplicateError));
        expect(await getTyped(col).all().count()).toEqual(3);
      });
    });
  });

  describe('remove', () => {
    const col = withCollection(db, {
      keys: { idxs: {} },
      seed: [
        { id: '1', idxs: '1' },
        { id: '2', idxs: '2' },
        { id: '3', idxs: '2', value: 'B2' },
      ],
    });

    it('removes items from the collection', async ({ getTyped }) => {
      await getTyped(col).where('id', '2').remove();

      expect(new Set(await fromAsync(getTyped(col).all().values()))).toEqual(
        new Set([
          { id: '1', idxs: '1' },
          { id: '3', idxs: '2', value: 'B2' },
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
          const col = getTyped(db).getCollection<any>(getUniqueName());
          const expected: any = { id: '1' };
          const tasks = [];
          for (let i = 0; i < concurrency; ++i) {
            const attr = `v${i}`;
            expected[attr] = 9;

            tasks.push(async () => {
              for (let n = 0; n < 10; ++n) {
                await col.where('id', '1').update({ [attr]: n });
              }
            });
          }
          await col.add({ id: '1' });

          await runAll(tasks.map((t) => t()));

          expect(await col.where('id', '1').get()).toEqual(expected);

          await col.removeAllAndDestroy();
        },
        { timeout: 20000 },
      );

      it('allows the first entry to upsert', async ({ getTyped }) => {
        const col = getTyped(db).getCollection<any>(getUniqueName());
        const expected: any = { id: '1' };
        const tasks = [];
        for (let i = 0; i < concurrency; ++i) {
          const attr = `v${i}`;
          expected[attr] = 1;

          tasks.push(async () => {
            await col.where('id', '1').update({ [attr]: 1 }, { upsert: true });
          });
        }

        await runAll(tasks.map((t) => t()));

        expect(await col.where('id', '1').get()).toEqual(expected);

        await col.removeAllAndDestroy();
      });
    });
  });

  describe(
    'security',
    () => {
      it('is allowed in collection names', async ({ getTyped }, { value, excludeStructure }) => {
        assume(excludeStructure).isFalsy();

        const col = getTyped(db).getCollection<{ id: string; value: string }>(
          value + getUniqueName(),
        );

        await col.add({ id: '1', value: 'foo' });
        expect(await col.where('id', '1').get()).toEqual({ id: '1', value: 'foo' });

        await col.where('id', '1').update({ value: 'bar' });
        expect(await col.where('id', '1').get()).toEqual({ id: '1', value: 'bar' });

        await col.where('id', '2').update({ value: 'wee' }, { upsert: true });
        expect(await col.where('id', '2').get()).toEqual({ id: '2', value: 'wee' });

        await col.where('id', '2').update({ value: 'woo' }, { upsert: true });
        expect(await col.where('id', '2').get()).toEqual({ id: '2', value: 'woo' });

        await col.removeAllAndDestroy();
      });

      it('is allowed in attribute names', async ({ getTyped }, {
        value,
        excludeAttributeName,
        allowRejection,
      }) => {
        assume(excludeAttributeName).isFalsy();

        const col = sharedCol(getTyped(db));

        // Basic add, get, partial get
        const id = getUniqueName();
        try {
          await col.add(
            Object.fromEntries([
              ['id', id],
              [value, 'foo'],
            ]),
          );
        } catch (err) {
          if (allowRejection) {
            return; // rejection is accepted as a pass
          }
          throw err;
        }

        const retrieved = await col.where('id', id).get();
        expect(retrieved).toBeTruthy();
        expect(retrieved!['id']).toEqual(id);
        expect(retrieved![value]).toEqual('foo');

        const retrievedPart = await col.where('id', id).attrs(['id', value]).get();
        expect(retrievedPart).toBeTruthy();
        expect(retrievedPart!['id']).toEqual(id);
        expect(retrievedPart![value]).toEqual('foo');

        // Update
        await col.where('id', id).update(Object.fromEntries([[value, 'bar']]));

        const retrievedUpdated = await col.where('id', id).get();
        expect(retrievedUpdated![value]).toEqual('bar');

        // Upsert
        const id2 = getUniqueName();
        await col.where('id', id2).update(Object.fromEntries([[value, 'wee']]), { upsert: true });

        const retrievedUpserted = await col.where('id', id2).get();
        expect(retrievedUpserted![value]).toEqual('wee');

        await col.where('id', id2).update(Object.fromEntries([[value, 'woo']]), { upsert: true });

        const retrievedUpserted2 = await col.where('id', id2).get();
        expect(retrievedUpserted2![value]).toEqual('woo');

        // Add without field
        const id3 = getUniqueName();
        await col.add({ id: id3 });

        const retrievedWithout = await col.where('id', id3).get();
        expect(retrievedWithout!['id']).toEqual(id3);
        expect(Object.prototype.hasOwnProperty.call(retrievedWithout, value)).toBeFalsy();

        expect(retrievedWithout!.constructor).toBe(Object);
        expect(retrievedWithout!['__proto__']).toBe(Object.prototype);
        expect(retrievedWithout!.hasOwnProperty).toBe(Object.prototype.hasOwnProperty);

        // Malicious add
        const id4 = getUniqueName();
        await col.add(
          Object.fromEntries([
            ['id', id4],
            [value, { attack: 'eep' }],
          ]),
        );
        const retrievedMalicious = await col.where('id', id4).get();
        expect(retrievedMalicious!['attack']).toBeUndefined();
        expect(({} as any).attack).toBeUndefined();
      });

      it('is allowed in values', async ({ getTyped }, { value, allowRejection }) => {
        const col = sharedCol(getTyped(db));

        // Basic add, get, partial get
        const id = getUniqueName();
        try {
          await col.add({ id: id, value });
        } catch (err) {
          if (allowRejection) {
            return; // rejection is accepted as a pass
          }
          throw err;
        }

        const retrieved = await col.where('id', id).get();
        expect(retrieved).toBeTruthy();
        expect(retrieved!['value']).toEqual(value);

        const retrievedPart = await col.where('id', id).attrs(['value']).get();
        expect(retrievedPart).toBeTruthy();
        expect(retrievedPart!['value']).toEqual(value);

        // Update
        const id2 = getUniqueName();
        await col.add({ id: id2, value: '' });
        await col.where('id', id2).update({ value });

        const retrievedUpdated = await col.where('id', id2).get();
        expect(retrievedUpdated!['value']).toEqual(value);
      });

      it('is allowed in object keys in values', async ({ getTyped }, { value, allowRejection }) => {
        const col = sharedCol(getTyped(db));

        // Basic add, get, partial get
        const id = getUniqueName();
        try {
          await col.add({ id: id, value: Object.fromEntries([[value, 'foo']]) });
        } catch (err) {
          if (allowRejection) {
            return; // rejection is accepted as a pass
          }
          throw err;
        }

        const retrieved = await col.where('id', id).get();
        expect(retrieved).toBeTruthy();
        expect(retrieved!['value'][value]).toEqual('foo');

        const retrievedPart = await col.where('id', id).attrs(['value']).get();
        expect(retrievedPart).toBeTruthy();
        expect(retrievedPart!['value'][value]).toEqual('foo');

        // Update
        await col.where('id', id).update({ value: Object.fromEntries([[value, 'bar']]) });

        const retrievedUpdated = await col.where('id', id).get();
        expect(retrievedUpdated!['value'][value]).toEqual('bar');

        // Malicious add
        const id2 = getUniqueName();
        await col.add({ id: id2, value: Object.fromEntries([[value, { attack: 'eep' }]]) });
        const retrievedMalicious = await col.where('id', id2).get();
        expect(retrievedMalicious!['value'].attack).toBeUndefined();
        expect(({} as any).attack).toBeUndefined();
      });

      it('is allowed in indices', async ({ getTyped }, { value, excludeStructure }) => {
        assume(excludeStructure).isFalsy();

        const col = getTyped(db).getCollection<any>(
          getUniqueName(),
          Object.fromEntries([[value, { unique: true }]]),
        );

        // Basic add, get
        await col.add(
          Object.fromEntries([
            ['id', '1'],
            [value, 'foo'],
          ]),
        );

        const retrieved = await col.where(value, 'foo').get();
        expect(retrieved).toBeTruthy();
        expect(retrieved!['id']).toEqual('1');
        expect(retrieved![value]).toEqual('foo');

        // Update by id, attribute
        await col.where('id', '1').update(Object.fromEntries([[value, 'bar']]));

        const retrievedUpdated = await col.where('id', '1').get();
        expect(retrievedUpdated![value]).toEqual('bar');

        await col.where(value, 'bar').update(Object.fromEntries([[value, 'baz']]));

        const retrievedUpdated2 = await col.where('id', '1').get();
        expect(retrievedUpdated2![value]).toEqual('baz');

        // Upsert
        await col.where('id', '2').update(Object.fromEntries([[value, 'wee']]), { upsert: true });

        const retrievedUpserted = await col.where('id', '2').get();
        expect(retrievedUpserted![value]).toEqual('wee');

        await col.where('id', '2').update(Object.fromEntries([[value, 'woo']]), { upsert: true });

        const retrievedUpserted2 = await col.where('id', '2').get();
        expect(retrievedUpserted2![value]).toEqual('woo');

        await col.removeAllAndDestroy();
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

  return { db };
};

export const migrationContract = <T extends DB>({
  factory,
  testWrapper, // like beforeEach, but runs after any test prep has completed
}: {
  factory: () => () => Promise<T> | T;
  testWrapper?: (options: TypedParameters & { dbBefore: T; dbAfter: T }) => (() => void) | void;
}) => {
  const dbGenerator = beforeEach<() => Promise<T> | T>(async ({ setParameter }) =>
    setParameter(factory()),
  );

  const dbBefore = beforeEach<T>(async ({ setParameter, getTyped }) => {
    const db = await getTyped(dbGenerator)();
    setParameter(db);
    return () => db.close();
  });

  const colBefore = withCollection(dbBefore, {
    keys: { idx: {}, uidx: { unique: true } },
    seed: [
      { id: '1', idx: 1, uidx: 'v1', a: 'a1', b: 'b1' },
      { id: '2', idx: 2, uidx: 'v2', a: 'a2', b: 'b2' },
      { id: '3', idx: 3, uidx: 'v3', a: 'a2', b: 'b3' },
    ],
  });

  const dbAfter = beforeEach<T>(async ({ setParameter, getTyped }) => {
    const db = await getTyped(dbGenerator)();
    setParameter(db);
    return () => db.close();
  });

  const it = async (
    name: string,
    fn: (
      options: TypedParameters & { dbBefore: T; dbAfter: T },
      ...args: any[]
    ) => Promise<void> | void,
    options?: { timeout?: number },
  ) => {
    vanillaIt(name, { timeout: 5000, ...options }, async (options, ...rest) => {
      const augmentedOptions = {
        ...options,
        dbBefore: options.getTyped(dbBefore),
        dbAfter: options.getTyped(dbAfter),
      };
      const teardown = testWrapper?.(augmentedOptions);
      await fn(augmentedOptions, ...rest);
      teardown?.();
    });
  };

  it('adds indices', async ({ getTyped }) => {
    const col = getTyped(dbAfter).getCollection<TestType>(getTyped(colBefore).name, {
      idx: {},
      uidx: { unique: true },
      idxs: {},
    });

    await col.add({
      id: '4',
      idx: 4,
      uidx: 'v4',
      a: 'a4',
      b: 'b4',
      idxs: 's4',
    });

    expect(new Set(await fromAsync(col.where('idxs', 's4').values()))).toEqual(
      new Set([{ id: '4', idx: 4, uidx: 'v4', a: 'a4', b: 'b4', idxs: 's4' }]),
    );
  });

  it('adds indices with existing data', async ({ getTyped }) => {
    const col = getTyped(dbAfter).getCollection<TestType>(getTyped(colBefore).name, {
      idx: {},
      uidx: { unique: true },
      a: {},
    });

    await col.add({ id: '4', idx: 4, uidx: 'v4', a: 'a1', b: 'b4' });

    expect(new Set(await fromAsync(col.where('a', 'a2').values()))).toEqual(
      new Set([
        { id: '2', idx: 2, uidx: 'v2', a: 'a2', b: 'b2' },
        { id: '3', idx: 3, uidx: 'v3', a: 'a2', b: 'b3' },
      ]),
    );
  });

  it('adds unique indices with existing data', async ({ getTyped }) => {
    const col = getTyped(dbAfter).getCollection<TestType>(getTyped(colBefore).name, {
      idx: {},
      uidx: { unique: true },
      b: { unique: true },
    });

    await expect(() => col.add({ id: '4', idx: 4, uidx: 'v4', a: 'a4', b: 'b3' })).throws(
      isInstanceOf(DuplicateError),
    );

    expect(new Set(await fromAsync(col.where('b', 'b2').values()))).toEqual(
      new Set([{ id: '2', idx: 2, uidx: 'v2', a: 'a2', b: 'b2' }]),
    );
  });

  it('adds uniqueness to existing indices', async ({ getTyped }) => {
    const col = getTyped(dbAfter).getCollection<TestType>(getTyped(colBefore).name, {
      idx: { unique: true },
      uidx: { unique: true },
    });

    await expect(() => col.add({ id: '4', idx: 3, uidx: 'v4', a: 'a4', b: 'b4' })).throws(
      isInstanceOf(DuplicateError),
    );

    expect(new Set(await fromAsync(col.where('idx', 2).values()))).toEqual(
      new Set([{ id: '2', idx: 2, uidx: 'v2', a: 'a2', b: 'b2' }]),
    );
  });

  it('throws if duplicate values exist when adding uniqueness', async ({ getTyped }) => {
    await getTyped(colBefore).add({ id: '4', idx: 3, uidx: 'v4', a: 'a4', b: 'b4' });

    // exception may be asynchronous, so not seen until first operation:
    await expect(async () => {
      const col = getTyped(dbAfter).getCollection<TestType>(getTyped(colBefore).name, {
        idx: { unique: true },
        uidx: { unique: true },
      });
      await col.all().count();
    }).throws();
  });

  it('removes uniqueness from existing indices', async ({ getTyped }) => {
    const col = getTyped(dbAfter).getCollection<TestType>(getTyped(colBefore).name, {
      idx: {},
      uidx: {},
    });

    await col.add({ id: '4', idx: 4, uidx: 'v3', a: 'a4', b: 'b4' });

    expect(new Set(await fromAsync(col.where('uidx', 'v3').values()))).toEqual(
      new Set([
        { id: '3', idx: 3, uidx: 'v3', a: 'a2', b: 'b3' },
        { id: '4', idx: 4, uidx: 'v3', a: 'a4', b: 'b4' },
      ]),
    );
  });

  it('removes indices', async ({ getTyped }) => {
    const col = getTyped(dbAfter).getCollection<TestType>(getTyped(colBefore).name, {
      uidx: { unique: true },
    });

    await expect(() => col.where('idx', 1)).throws('No index for attribute idx');
  });

  it('removes unique indices', async ({ getTyped }) => {
    const col = getTyped(dbAfter).getCollection<TestType>(getTyped(colBefore).name, { idx: {} });

    await col.add({ id: '4', idx: 4, uidx: 'v3', a: 'a4', b: 'b4' });

    await expect(() => col.where('uidx', 'v2')).throws('No index for attribute uidx');
  });

  return { dbBefore, dbAfter };
};

interface TestType {
  id: string;
  idx?: number;
  uidx?: string;
  idxs?: string;
  value?: string; // may be encrypted/compressed/etc. by the storage (e.g. see 'encrypted integration') - cannot be used as an index
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
  {
    keys = {},
    name = getUniqueName(),
    seed = [],
  }: {
    keys?: DBKeys<T>;
    name?: string;
    seed?: T[];
  } = {},
) {
  return beforeEach<Collection<T>>(async ({ getTyped, setParameter }) => {
    const col = getTyped(db).getCollection(name, keys);
    setParameter(col);
    await col.add(...seed);

    return () => col.removeAllAndDestroy();
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
