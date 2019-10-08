import DB from './interfaces/DB';
import Collection from './interfaces/Collection';

interface TestType {
  id: string;
  idx?: number;
  idxs?: string;
  value?: string;
  a?: string;
  b?: string;
}

async function runAll<T>(promises: Promise<T>[]): Promise<T[]> {
  // https://github.com/microsoft/TypeScript/issues/31083
  const results = await (Promise as any).allSettled(promises);

  const failures = results.filter((r: any) => r.status === 'rejected');
  if (failures.length > 0) {
    const description = failures
      .map((r: any) => r.reason)
      .join(', ');
    throw new Error(`Parallel tasks failed: ${description}`);
  }
  return results.map((r: any) => r.value);
}

export default ({ factory }: { factory: () => Promise<DB> | DB }): void => {
  let db: DB;
  let col: Collection<TestType>;

  beforeEach(async () => {
    db = await factory();
  });

  afterEach(async () => {
    await db.close();
  });

  it('stores and retrieves data', async () => {
    col = db.getCollection('test-simple');

    const stored = { id: '1', value: 'foo' };
    await col.add(stored);

    const retrieved = await col.get('id', stored.id);

    expect(retrieved).toEqual(stored);
    expect(retrieved === stored).toEqual(false);
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
    const specialCharCol = db.getCollection<any>('test-simple');

    const stored = { id: '1', [attribute]: 'foo' };
    await specialCharCol.add(stored);
    const retrieved = await specialCharCol.get('id', stored.id);

    expect(retrieved).toEqual(stored);
  });

  it('allows special characters in indices', async () => {
    const attribute = '\\s\'p"e-c_i+a=l&c$h!a:r;a?c,t.e(r)s%h[e]r{e}\\';
    const specialCharCol = db.getCollection<any>('test-simple', {
      [attribute]: { unique: true },
    });

    const stored = { id: '1', [attribute]: 'foo' };
    await specialCharCol.add(stored);
    const retrieved = await specialCharCol.get(attribute, 'foo');

    expect(retrieved).toEqual(stored);
  });

  it('stores and retrieves JSON data', async () => {
    const stored = { id: '1', value: { nested: ['hi', { object: 3 }] } };
    const complexCol = db.getCollection<typeof stored>('test-json');

    await complexCol.add(stored);

    const retrieved = await complexCol.get('id', stored.id);

    expect(retrieved!.value).toEqual(stored.value);
    expect(retrieved === stored).toEqual(false);
  });

  it('stores and retrieves binary data', async () => {
    const stored = { id: '1', value: Buffer.from('hello', 'utf8') };
    const complexCol = db.getCollection<typeof stored>('test-json');

    await complexCol.add(stored);

    const retrieved = await complexCol.get('id', stored.id);

    expect([...retrieved!.value]).toEqual([...stored.value]);
    expect(retrieved === stored).toEqual(false);
  });

  it('allows duplicates in non-unique indices and retrieves all', async () => {
    col = db.getCollection<TestType>('test-index', {
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
    col = db.getCollection('test-simple');

    await db.close();

    let capturedError = null;
    try {
      await col.add({ id: '1', value: 'foo' });
    } catch (e) {
      capturedError = e;
    }
    expect(capturedError).not.toEqual(null);
  });

  describe('add', () => {
    it('rejects duplicate IDs', async () => {
      col = db.getCollection('test-simple');

      await col.add({ id: '2', value: 'bar' });
      await col.add({ id: '3', value: 'baz' });
      let capturedError = null;
      try {
        await col.add({ id: '2', value: 'nope' });
      } catch (e) {
        capturedError = e;
      }
      expect(capturedError).not.toEqual(null);
    });

    it('rejects duplicates in unique indices', async () => {
      col = db.getCollection<TestType>('test-unique', {
        idx: { unique: true },
      });

      await col.add({ id: '1', idx: 8 });
      await col.add({ id: '2', idx: 9 });
      let capturedError = null;
      try {
        await col.add({ id: '3', idx: 8 });
      } catch (e) {
        capturedError = e;
      }
      expect(capturedError).not.toEqual(null);
    });
  });

  describe('get', () => {
    beforeEach(async () => {
      col = db.getCollection<TestType>('test-get', { idx: {} });

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
      let capturedError = null;
      try {
        await col.get('b', 'B1');
      } catch (e) {
        capturedError = e;
      }
      expect(capturedError).not.toEqual(null);
    });

    it('returns null if no values match', async () => {
      const v = await col.get('idx', 3);
      expect(v).toEqual(null);
    });

    it('allows querying by JSON data', async () => {
      const value = { nested: ['hi', { object: 3 }] };
      const stored = { id: '1', value };
      const complexCol = db.getCollection<typeof stored>('test-json-get', {
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
      const complexCol = db.getCollection<typeof stored>('test-json-get', {
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
      col = db.getCollection<TestType>('test-get', { idx: {} });

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
      let capturedError = null;
      try {
        await col.getAll('b', 'B1');
      } catch (e) {
        capturedError = e;
      }
      expect(capturedError).not.toEqual(null);
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
      col = db.getCollection<TestType>('test-update', {
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
      let capturedError = null;
      try {
        await col.update('id', '2', { a: 'A1' });
      } catch (e) {
        capturedError = e;
      }
      expect(capturedError).not.toEqual(null);

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
      let capturedError = null;
      try {
        await col.update('id', '2', { id: '4' });
      } catch (e) {
        capturedError = e;
      }
      expect(capturedError).not.toEqual(null);

      const v2 = await col.get('id', '2');
      expect(v2).not.toEqual(null);
    });

    it('allows setting ID to the same value', async () => {
      await col.update('id', '2', { id: '2', b: 'updated' });

      const v2 = await col.get('id', '2');
      expect(v2!.b).toEqual('updated');
    });

    it('changes exactly one matching entry', async () => {
      await col.update('idxs', '2', { b: 'updated' });
      const [v2, v3] = await runAll([
        col.get('id', '2'),
        col.get('id', '3'),
      ]);
      const updated2 = (v2!.b === 'updated');
      const updated3 = (v3!.b === 'updated');
      expect(updated2).not.toEqual(updated3);
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
      let capturedError = null;
      try {
        await col.update('b', 'B2', { a: 'updated' });
      } catch (e) {
        capturedError = e;
      }
      expect(capturedError).not.toEqual(null);
    });

    describe('upsert', () => {
      it('adds a new record if no value matches using key ID', async () => {
        const data = { idxs: 'x', a: 'y', b: 'z' };
        await col.update('id', '4', data, { upsert: true });
        const all = await col.getAll();
        expect(all.length).toEqual(4);
      });

      it('adds a new record if no value matches using value ID', async () => {
        const data = { id: '6', a: 'y', b: 'z' };
        await col.update('idxs', 'x', data, { upsert: true });
        const all = await col.getAll();
        expect(all.length).toEqual(4);
      });

      it('rejects upserting new records without IDs', async () => {
        let capturedError = null;
        try {
          await col.update('idxs', '10', { b: 'updated' }, { upsert: true });
        } catch (e) {
          capturedError = e;
        }
        expect(capturedError).not.toEqual(null);
        const all = await col.getAll();
        expect(all.length).toEqual(3);
      });

      it('rejects duplicates if no value matches', async () => {
        let capturedError = null;
        try {
          await col.update('idxs', '10', { a: 'A2' }, { upsert: true });
        } catch (e) {
          capturedError = e;
        }
        expect(capturedError).not.toEqual(null);
        const all = await col.getAll();
        expect(all.length).toEqual(3);
      });
    });
  });

  describe('remove', () => {
    beforeEach(async () => {
      col = db.getCollection<TestType>('test-remove', { idxs: {} });

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
      let capturedError = null;
      try {
        await col.remove('b', 'B2');
      } catch (e) {
        capturedError = e;
      }
      expect(capturedError).not.toEqual(null);
    });
  });

  describe('single-threaded concurrency', () => {
    const concurrency = 32;

    describe('update', () => {
      it('does not clobber other thread changes', async () => {
        const c = db.getCollection<any>('test-update');
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
        const c = db.getCollection<any>('test-update');
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
};
