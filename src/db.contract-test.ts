import type { DB } from './interfaces/DB';
import type { Collection } from './interfaces/Collection';
import { TestWrapper, wrapJest } from './test-helpers/wrapJest';

interface TestType {
  id: string;
  idx?: number;
  idxs?: string;
  value?: string;
  a?: string;
  b?: string;
}

function isRejected<T>(r: PromiseSettledResult<T>): r is PromiseRejectedResult {
  return r.status === 'rejected';
}

async function runAll<T>(promises: Promise<T>[]): Promise<T[]> {
  const results = await Promise.allSettled(promises);

  const failures = results.filter(isRejected);
  if (failures.length > 0) {
    const description = failures
      .map((r) => r.reason)
      .join(', ');
    throw new Error(`Parallel tasks failed: ${description}`);
  }
  return (results as PromiseFulfilledResult<T>[]).map((r) => r.value);
}

function getUniqueName(): string {
  const time = Date.now().toFixed(0);
  const random = Math.random().toFixed(8).substr(2);
  return `test-${time.substr(time.length - 7)}${random}`;
}

interface ConfigT<T extends DB> {
  beforeAll?: () => Promise<void> | void;
  factory: () => Promise<T> | T;
  testWrapper?: TestWrapper<() => T>;
  afterAll?: () => Promise<void> | void;
  testMigration?: boolean;
}

const nop = (): void => undefined;

// if the factory throws an exception, this stand-in causes tests to
// fail with a reliable message
function makeFailedDB<T extends DB>(e: unknown): T {
  return new Proxy<T>({} as T, {
    get(target, prop): unknown {
      if (prop === 'close') {
        return nop;
      }
      throw e;
    },
  });
}

// eslint-disable-next-line jest/no-export
export default <T extends DB>({
  beforeAll: beforeAllFn = nop,
  factory,
  testWrapper,
  afterAll: afterAllFn = nop,
  testMigration = true,
}: ConfigT<T>): void => {
  let db: T;
  let col: Collection<TestType>;

  beforeAll(beforeAllFn);
  afterAll(afterAllFn);

  beforeEach(async () => {
    db = makeFailedDB(new Error('database construction timed out'));
    try {
      db = await factory();
    } catch (e) {
      db = makeFailedDB(e);
    }
  });

  afterEach(async () => {
    await db.close();
  });

  // https://github.com/facebook/jest/issues/7774
  const { it, describe } = wrapJest(testWrapper, () => db);

  it('stores and retrieves data', async () => {
    col = db.getCollection('test-simple');

    const stored = { id: '1', value: 'foo' };
    await col.add(stored);

    const retrieved = await col.get('id', stored.id);

    expect(retrieved).toEqual(stored);
    expect(retrieved).not.toBe(stored);
  });

  it('allows special characters in collection names', async () => {
    const name = 'test-\\s\'p"e-c_i+a=l&c$h!a:r;a?c,t.e(r)s%h[e]r{e}\\';
    col = db.getCollection(name);

    const stored = { id: '1', value: 'foo' };
    await col.add(stored);
    const retrieved = await col.get('id', stored.id);

    expect(retrieved).toEqual(stored);
  });

  it('allows special characters in attribute names', async () => {
    const attribute = '\\s\'p"e-c_i+a=l&c$h!a:r;a?c,t.e(r)s%h[e]r{e}\\';
    const specialCharCol = db.getCollection<any>(getUniqueName());

    const stored = { id: '1', [attribute]: 'foo' };
    await specialCharCol.add(stored);
    const retrieved = await specialCharCol.get('id', stored.id);

    expect(retrieved).toEqual(stored);
  });

  it('allows special characters in indices', async () => {
    const attribute = '\\s\'p"e-c_i+a=l&c$h!a:r;a?c,t.e(r)s%h[e]r{e}\\';
    const specialCharCol = db.getCollection<any>(getUniqueName(), {
      [attribute]: { unique: true },
    });

    const stored = { id: '1', [attribute]: 'foo' };
    await specialCharCol.add(stored);
    const retrieved = await specialCharCol.get(attribute, 'foo');

    expect(retrieved).toEqual(stored);
  });

  it('stores and retrieves JSON data', async () => {
    const stored = { id: '1', value: { nested: ['hi', { object: 3 }] } };
    const complexCol = db.getCollection<typeof stored>(getUniqueName());

    await complexCol.add(stored);

    const retrieved = await complexCol.get('id', stored.id);

    expect(retrieved!.value).toEqual(stored.value);
    expect(retrieved).not.toBe(stored);
  });

  it('stores and retrieves binary data', async () => {
    const stored = { id: '1', value: Buffer.from('hello', 'utf8') };
    const complexCol = db.getCollection<typeof stored>(getUniqueName());

    await complexCol.add(stored);

    const retrieved = await complexCol.get('id', stored.id);

    expect([...retrieved!.value]).toEqual([...stored.value]);
    expect(retrieved).not.toBe(stored);
  });

  it('allows duplicates in non-unique indices and retrieves all', async () => {
    col = db.getCollection<TestType>(getUniqueName(), {
      idx: {},
    });

    await runAll([
      col.add({ id: '1', idx: 8 }),
      col.add({ id: '2', idx: 8 }),
      col.add({ id: '3', idx: 10 }),
    ]);

    const retrieved = await col.getAll('idx', 8);
    expect(retrieved.length).toEqual(2);
    const retrievedIds = retrieved.map(({ id }) => id);
    expect(new Set(retrievedIds)).toEqual(new Set(['1', '2']));
  });

  it('rejects access after closing', async () => {
    col = db.getCollection(getUniqueName());
    await col.add({ id: '1', value: 'foo' });

    await db.close();

    await expect(col.add({ id: '2', value: 'bar' })).rejects.not.toBeNull();
  });

  it('survives immediate database closure', async () => {
    // create a complex collection which will often need database setup at construction time:
    col = db.getCollection(getUniqueName(), { idx: {}, value: { unique: true } });
    await db.close(); // close before database setup has completed

    await expect(col.add({ id: '1', value: 'foo' })).rejects.not.toBeNull();
  });

  it('ignores duplicate close() calls', async () => {
    await db.close();
    expect(db.close()).not.toBeInstanceOf(Promise);
  });

  it('returns the same collection object for subsequent requests', async () => {
    const name = getUniqueName();
    const col1 = db.getCollection(name);
    const col2 = db.getCollection(name);

    expect(col2).toBe(col1);
  });

  it('rejects attempts to get the same collection with different key schemas', async () => {
    const name = getUniqueName();
    const keys1 = { idx: { unique: true } };
    const keys2 = { value: { unique: true } };
    db.getCollection<TestType>(name, keys1);

    expect(() => db.getCollection<TestType>(name, keys2)).toThrow();
  });

  it('allows distinct keys for the same collection if they are equivalent', async () => {
    const name = getUniqueName();
    const keys1 = { idx: { unique: true }, value: { unique: true } };
    const keys2 = { value: { unique: true }, idx: { unique: true } }; // same keys, different order
    const col1 = db.getCollection<TestType>(name, keys1);
    const col2 = db.getCollection<TestType>(name, keys2);

    expect(col2).toBe(col1);
  });

  describe('add', () => {
    it('rejects duplicate IDs', async () => {
      col = db.getCollection(getUniqueName());

      await col.add({ id: '2', value: 'bar' });
      await col.add({ id: '3', value: 'baz' });
      await expect(col.add({ id: '2', value: 'nope' })).rejects.not.toBeNull();
    });

    it('rejects duplicates in unique indices', async () => {
      col = db.getCollection<TestType>(getUniqueName(), {
        idx: { unique: true },
      });

      await col.add({ id: '1', idx: 8 });
      await col.add({ id: '2', idx: 9 });
      await expect(col.add({ id: '3', idx: 8 })).rejects.not.toBeNull();
    });
  });

  describe('get', () => {
    beforeEach(async () => {
      col = db.getCollection<TestType>(getUniqueName(), { idx: {} });

      await col.add({ id: '1', idx: 2, a: 'A1', b: 'B1' });
    });

    it('returns only the requested attributes', async () => {
      const v2 = await col.get('id', '1', ['idx', 'b']);
      expect(v2).toEqual({ idx: 2, b: 'B1' });
    });

    it('returns the special ID attribute if requested', async () => {
      const v2 = await col.get('id', '1', ['id', 'b']);
      expect(v2).toEqual({ id: '1', b: 'B1' });
    });

    it('returns all attributes by default', async () => {
      const v2 = await col.get('id', '1');
      expect(v2).toEqual({ id: '1', idx: 2, a: 'A1', b: 'B1' });
    });

    it('allows filters using any indexed attribute', async () => {
      const v = await col.get('idx', 2);
      expect(v!.id).toEqual('1');
    });

    it('rejects filters using unindexed keys', async () => {
      await expect(col.get('b', 'B1')).rejects.not.toBeNull();
    });

    it('returns null if no values match', async () => {
      const v = await col.get('idx', 3);
      expect(v).toEqual(null);
    });
  });

  describe('get unique', () => {
    beforeEach(async () => {
      col = db.getCollection<TestType>(getUniqueName(), {
        idx: { unique: true },
      });

      await col.add({ id: '1', idx: 2, a: 'A1', b: 'B1' });
    });

    it('returns only the requested attributes', async () => {
      const v2 = await col.get('idx', 2, ['idx', 'b']);
      expect(v2).toEqual({ idx: 2, b: 'B1' });
    });

    it('uses just the index if possible', async () => {
      const v2 = await col.get('idx', 2, ['idx', 'id']);
      expect(v2).toEqual({ idx: 2, id: '1' });
    });

    it('returns all attributes by default', async () => {
      const v2 = await col.get('idx', 2);
      expect(v2).toEqual({ id: '1', idx: 2, a: 'A1', b: 'B1' });
    });
  });

  describe('get data types', () => {
    it('allows querying by JSON data', async () => {
      const value = { nested: ['hi', { object: 3 }] };
      const stored = { id: '1', value };
      const complexCol = db.getCollection<typeof stored>(getUniqueName(), {
        value: {},
      });

      await complexCol.add(stored);

      const sameValue = { ...value };
      const otherValue = { nested: ['nah', { object: 3 }] };

      expect((await complexCol.get('value', sameValue))!.id).toEqual('1');
      expect((await complexCol.get('value', otherValue))).toBeNull();
    });

    it('allows querying by binary data', async () => {
      const value = Buffer.from('hello', 'utf8');
      const stored = { id: '1', value };
      const complexCol = db.getCollection<typeof stored>(getUniqueName(), {
        value: {},
      });

      await complexCol.add(stored);

      const sameValue = Buffer.from(value);
      const otherValue = Buffer.from('nah', 'utf8');

      expect((await complexCol.get('value', sameValue))!.id).toEqual('1');
      expect((await complexCol.get('value', otherValue))).toBeNull();
    });
  });

  describe('getAll', () => {
    beforeEach(async () => {
      col = db.getCollection<TestType>(getUniqueName(), { idx: {} });

      await runAll([
        col.add({ id: '1', idx: 1, a: 'A1', b: 'B1' }),
        col.add({ id: '2', idx: 2, a: 'A2', b: 'B2' }),
        col.add({ id: '3', idx: 2, a: 'A3', b: 'B3' }),
      ]);
    });

    it('returns only the requested attributes', async () => {
      const v = await col.getAll('id', '1', ['idx', 'b']);
      expect(v).toEqual([{ idx: 1, b: 'B1' }]);
    });

    it('returns all attributes by default', async () => {
      const v = await col.getAll('id', '1');
      expect(v).toEqual([{ id: '1', idx: 1, a: 'A1', b: 'B1' }]);
    });

    it('allows filters using any indexed attribute', async () => {
      const v = await col.getAll('idx', 2);
      expect(new Set(v)).toEqual(new Set([
        { id: '2', idx: 2, a: 'A2', b: 'B2' },
        { id: '3', idx: 2, a: 'A3', b: 'B3' },
      ]));
    });

    it('rejects filters using unindexed keys', async () => {
      await expect(col.getAll('b', 'B1')).rejects.not.toBeNull();
    });

    it('returns an empty list if no values match', async () => {
      const v = await col.getAll('idx', 3);
      expect(v).toEqual([]);
    });

    it('returns all values if no filter is specified', async () => {
      const v = await col.getAll();
      expect(v.length).toEqual(3);
    });
  });

  describe('update', () => {
    beforeEach(async () => {
      col = db.getCollection<TestType>(getUniqueName(), {
        idxs: {},
        a: { unique: true },
      });

      await runAll([
        col.add({ id: '1', idxs: '1', a: 'A1', b: 'B1' }),
        col.add({ id: '2', idxs: '2', a: 'A2', b: 'B2' }),
        col.add({ id: '3', idxs: '2', a: 'A3', b: 'B3' }),
      ]);
    });

    it('changes only matching entries', async () => {
      await col.update('id', '2', { b: 'updated' });
      const [v1, v2, v3] = await runAll([
        col.get('id', '1'),
        col.get('id', '2'),
        col.get('id', '3'),
      ]);
      expect(v1!.b).toEqual('B1');
      expect(v2!.b).toEqual('updated');
      expect(v3!.b).toEqual('B3');
    });

    it('rejects and rolls-back changes which cause duplicates', async () => {
      await expect(col.update('id', '2', { a: 'A1' })).rejects.not.toBeNull();

      const v2 = await col.get('id', '2');
      expect(v2!.a).toEqual('A2');
    });

    it('allows setting unique columns to the same value', async () => {
      await col.update('id', '2', { a: 'A2', b: 'updated' });

      const v2 = await col.get('id', '2');
      expect(v2!.a).toEqual('A2');
      expect(v2!.b).toEqual('updated');
    });

    it('allows setting unique columns to historic values', async () => {
      await col.update('id', '3', { a: 'A3b' });
      await col.update('id', '2', { a: 'A3' });

      const v2 = await col.get('id', '2');
      expect(v2!.a).toEqual('A3');
    });

    it('rejects attempts to change the ID', async () => {
      await expect(col.update('id', '2', { id: '4' })).rejects.not.toBeNull();

      const v2 = await col.get('id', '2');
      expect(v2).not.toEqual(null);
    });

    it('allows setting ID to the same value', async () => {
      await col.update('id', '2', { id: '2', b: 'updated' });

      const v2 = await col.get('id', '2');
      expect(v2!.b).toEqual('updated');
    });

    it('changes all matching entries', async () => {
      await col.update('idxs', '2', { b: 'updated' });
      const [v2, v3] = await runAll([
        col.get('id', '2'),
        col.get('id', '3'),
      ]);
      expect(v2!.b).toEqual('updated');
      expect(v3!.b).toEqual('updated');
    });

    it('rejects conflicts from changing multiple records', async () => {
      await expect(col.update('idxs', '2', { a: 'multi' })).rejects.not.toBeNull();
      const [v2, v3] = await runAll([
        col.get('id', '2'),
        col.get('id', '3'),
      ]);
      expect(v2!.a).toEqual('A2');
      expect(v3!.a).toEqual('A3');
    });

    it('leaves unspecified properties unchanged', async () => {
      await col.update('id', '2', { b: 'updated' });
      const v2 = await col.get('id', '2');
      expect(v2!.a).toEqual('A2');
    });

    it('does nothing if no value matches', async () => {
      await col.update('idxs', '10', { b: 'updated' });
      const [v1, v2, v3] = await runAll([
        col.get('id', '1'),
        col.get('id', '2'),
        col.get('id', '3'),
      ]);
      expect(v1!.b).toEqual('B1');
      expect(v2!.b).toEqual('B2');
      expect(v3!.b).toEqual('B3');
      const all = await col.getAll();
      expect(all.length).toEqual(3);
    });

    it('rejects filters using unindexed keys', async () => {
      await expect(col.update('b', 'B2', { a: 'updated' })).rejects.not.toBeNull();
    });

    describe('upsert', () => {
      it('updates existing records if found by ID', async () => {
        await col.update('id', '2', { b: 'updated' }, { upsert: true });

        const v = await col.get('id', '2');
        expect(v!.b).toEqual('updated');
        const all = await col.getAll();
        expect(all.length).toEqual(3);
      });

      it('preserves unmodified values when updating', async () => {
        await col.update('id', '2', { b: 'updated' }, { upsert: true });

        const v = await col.get('id', '2');
        expect(v!.a).toEqual('A2');
      });

      it('adds a new record if no value matches using key ID', async () => {
        const data = { idxs: 'x', a: 'y', b: 'z' };
        await col.update('id', '4', data, { upsert: true });
        const all = await col.getAll();
        expect(all.length).toEqual(4);
      });

      it('rejects attempts to upsert using a non-ID index', async () => {
        const data = { id: '6', idxs: 'w', a: 'y', b: 'z' };
        await expect(col.update('a', 'x', data, { upsert: true })).rejects.not.toBeNull();
        const all = await col.getAll();
        expect(all.length).toEqual(3);
      });

      it('rejects duplicates if no value matches', async () => {
        await expect(col.update('id', '6', { a: 'A2' }, { upsert: true })).rejects.not.toBeNull();
        const all = await col.getAll();
        expect(all.length).toEqual(3);
      });
    });
  });

  describe('remove', () => {
    beforeEach(async () => {
      col = db.getCollection<TestType>(getUniqueName(), { idxs: {} });

      await runAll([
        col.add({ id: '1', idxs: '1' }),
        col.add({ id: '2', idxs: '2' }),
        col.add({ id: '3', idxs: '2' }),
      ]);
    });

    it('removes items from the collection', async () => {
      await col.remove('id', '2');

      expect(new Set(await col.getAll())).toEqual(new Set([
        { id: '1', idxs: '1' },
        { id: '3', idxs: '2' },
      ]));
    });

    it('removes all items matching the query', async () => {
      await col.remove('idxs', '2');

      expect(new Set(await col.getAll())).toEqual(new Set([
        { id: '1', idxs: '1' },
      ]));
    });

    it('returns the number of items removed', async () => {
      const count = await col.remove('idxs', '2');
      expect(count).toEqual(2);
    });

    it('returns 0 if no values match for ID', async () => {
      const count = await col.remove('id', 'no');
      expect(count).toEqual(0);

      const remaining = await col.getAll();
      expect(remaining.length).toEqual(3);
    });

    it('returns 0 if no values match for field', async () => {
      const count = await col.remove('idxs', '10');
      expect(count).toEqual(0);

      const remaining = await col.getAll();
      expect(remaining.length).toEqual(3);
    });

    it('rejects filters using unindexed keys', async () => {
      await expect(col.remove('b', 'B2')).rejects.not.toBeNull();
    });
  });

  describe('single-threaded concurrency', () => {
    const concurrency = 32;

    describe('update', () => {
      it('does not clobber other thread changes', async () => {
        const c = db.getCollection<any>(getUniqueName());
        const expected: any = { id: '1' };
        const tasks = [];
        for (let i = 0; i < concurrency; i += 1) {
          const attr = `v${i}`;
          expected[attr] = 9;

          tasks.push(async () => {
            for (let n = 0; n < 10; n += 1) {
              // eslint-disable-next-line no-await-in-loop
              await c.update('id', '1', { [attr]: n });
            }
          });
        }
        await c.add({ id: '1' });

        await runAll(tasks.map((t) => t()));

        expect(await c.get('id', '1')).toEqual(expected);
      });

      it('allows the first entry to upsert', async () => {
        const c = db.getCollection<any>(getUniqueName());
        const expected: any = { id: '1' };
        const tasks = [];
        for (let i = 0; i < concurrency; i += 1) {
          const attr = `v${i}`;
          expected[attr] = 1;

          tasks.push(async () => {
            await c.update('id', '1', { [attr]: 1 }, { upsert: true });
          });
        }

        await runAll(tasks.map((t) => t()));

        expect(await c.get('id', '1')).toEqual(expected);
      });
    });
  });

  if (testMigration) {
    describe('data migration', () => {
      /* eslint-disable object-curly-newline */ // tabular data

      let name: string;
      let dbBefore: DB;
      let colBefore: Collection<TestType>;

      beforeEach(async () => {
        name = getUniqueName();
        dbBefore = makeFailedDB(new Error('database construction timed out'));
        try {
          dbBefore = await factory();
        } catch (e) {
          dbBefore = makeFailedDB(e);
        }

        colBefore = dbBefore.getCollection(name, { idx: {}, value: { unique: true } });
        await colBefore.add({ id: '1', idx: 1, value: 'v1', a: 'a1', b: 'b1' });
        await colBefore.add({ id: '2', idx: 2, value: 'v2', a: 'a2', b: 'b2' });
        await colBefore.add({ id: '3', idx: 3, value: 'v3', a: 'a2', b: 'b3' });
      });

      afterEach(async () => {
        await dbBefore.close();
      });

      it('adds indices', async () => {
        col = db.getCollection(name, { idx: {}, value: { unique: true }, idxs: {} });

        await col.add({ id: '4', idx: 4, value: 'v4', a: 'a4', b: 'b4', idxs: 's4' });

        expect(new Set(await col.getAll('idxs', 's4'))).toEqual(new Set([
          { id: '4', idx: 4, value: 'v4', a: 'a4', b: 'b4', idxs: 's4' },
        ]));
      });

      it('adds indices with existing data', async () => {
        col = db.getCollection(name, { idx: {}, value: { unique: true }, a: {} });

        await col.add({ id: '4', idx: 4, value: 'v4', a: 'a1', b: 'b4' });

        expect(new Set(await col.getAll('a', 'a2'))).toEqual(new Set([
          { id: '2', idx: 2, value: 'v2', a: 'a2', b: 'b2' },
          { id: '3', idx: 3, value: 'v3', a: 'a2', b: 'b3' },
        ]));
      });

      it('adds unique indices with existing data', async () => {
        col = db.getCollection(name, { idx: {}, value: { unique: true }, b: { unique: true } });

        await expect(col.add({ id: '4', idx: 4, value: 'v4', a: 'a4', b: 'b3' })).rejects.not.toBeNull();

        expect(new Set(await col.getAll('b', 'b2'))).toEqual(new Set([
          { id: '2', idx: 2, value: 'v2', a: 'a2', b: 'b2' },
        ]));
      });

      it('adds uniqueness to existing indices', async () => {
        col = db.getCollection(name, { idx: { unique: true }, value: { unique: true } });

        await expect(col.add({ id: '4', idx: 3, value: 'v4', a: 'a4', b: 'b4' })).rejects.not.toBeNull();

        expect(new Set(await col.getAll('idx', 2))).toEqual(new Set([
          { id: '2', idx: 2, value: 'v2', a: 'a2', b: 'b2' },
        ]));
      });

      it('throws if duplicate values exist when adding uniqueness', async () => {
        await colBefore.add({ id: '4', idx: 3, value: 'v4', a: 'a4', b: 'b4' });

        col = db.getCollection(name, { idx: { unique: true }, value: { unique: true } });
        // exception is asynchronous, so will not be seen until first operation:
        await expect(col.getAll()).rejects.not.toBeNull();
      });

      it('removes uniqueness from existing indices', async () => {
        col = db.getCollection(name, { idx: {}, value: {} });

        await col.add({ id: '4', idx: 4, value: 'v3', a: 'a4', b: 'b4' });

        expect(new Set(await col.getAll('value', 'v3'))).toEqual(new Set([
          { id: '3', idx: 3, value: 'v3', a: 'a2', b: 'b3' },
          { id: '4', idx: 4, value: 'v3', a: 'a4', b: 'b4' },
        ]));
      });

      it('removes indices', async () => {
        col = db.getCollection(name, { value: { unique: true } });

        await expect(col.getAll('idx', 1)).rejects.not.toBeNull();
      });

      it('removes unique indices', async () => {
        col = db.getCollection(name, { idx: {} });

        await col.add({ id: '4', idx: 4, value: 'v3', a: 'a4', b: 'b4' });

        await expect(col.getAll('value', 'v2')).rejects.not.toBeNull();
      });

      /* eslint-enable object-curly-newline */
    });
  }
};
