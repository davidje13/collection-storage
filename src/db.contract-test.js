export default ({ factory }) => {
  let db;
  let col;

  beforeEach(async () => {
    db = await factory();
  });

  it('stores and retrieves data', async () => {
    col = db.getCollection('test-simple');

    const stored = { id: '1', value: 'foo' };
    await col.add(stored);

    const retrieved = await col.get('id', stored.id);

    expect(retrieved).toEqual(stored);
    expect(retrieved === stored).toEqual(false);
  });

  it('allows duplicates in non-unique indices and retrieves all', async () => {
    col = db.getCollection('test-index', {
      idx: {},
    });

    await Promise.all([
      col.add({ id: '1', idx: 8 }),
      col.add({ id: '2', idx: 8 }),
      col.add({ id: '3', idx: 10 }),
    ]);

    const retrieved = await col.getAll('idx', 8);
    expect(retrieved.length).toEqual(2);
    const retrievedIds = retrieved.map(({ id }) => id);
    expect(new Set(retrievedIds)).toEqual(new Set(['1', '2']));
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
      col = db.getCollection('test-unique', {
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
      col = db.getCollection('test-get', { idx: {} });

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
      expect(v.id).toEqual('1');
    });

    it('returns null if no values match', async () => {
      const v = await col.get('idx', 3);
      expect(v).toEqual(null);
    });
  });

  describe('getAll', () => {
    beforeEach(async () => {
      col = db.getCollection('test-get', { idx: {} });

      await Promise.all([
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
      col = db.getCollection('test-update', {
        idx: {},
        a: { unique: true },
      });

      await Promise.all([
        col.add({ id: '1', idx: '1', a: 'A1', b: 'B1' }),
        col.add({ id: '2', idx: '2', a: 'A2', b: 'B2' }),
        col.add({ id: '3', idx: '2', a: 'A3', b: 'B3' }),
      ]);
    });

    it('changes only matching entries', async () => {
      await col.update('id', '2', { b: 'updated' });
      const [v1, v2, v3] = await Promise.all([
        col.get('id', '1'),
        col.get('id', '2'),
        col.get('id', '3'),
      ]);
      expect(v1.b).toEqual('B1');
      expect(v2.b).toEqual('updated');
      expect(v3.b).toEqual('B3');
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
      expect(v2.a).toEqual('A2');
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

    it('changes exactly one matching entry', async () => {
      await col.update('idx', '2', { b: 'updated' });
      const [v2, v3] = await Promise.all([
        col.get('id', '2'),
        col.get('id', '3'),
      ]);
      const updated2 = (v2.b === 'updated');
      const updated3 = (v3.b === 'updated');
      expect(updated2).not.toEqual(updated3);
    });

    it('leaves unspecified properties unchanged', async () => {
      await col.update('id', '2', { b: 'updated' });
      const v2 = await col.get('id', '2');
      expect(v2.a).toEqual('A2');
    });

    it('does nothing if no value matches', async () => {
      await col.update('idx', '10', { b: 'updated' });
      const [v1, v2, v3] = await Promise.all([
        col.get('id', '1'),
        col.get('id', '2'),
        col.get('id', '3'),
      ]);
      expect(v1.b).toEqual('B1');
      expect(v2.b).toEqual('B2');
      expect(v3.b).toEqual('B3');
      const all = await col.getAll();
      expect(all.length).toEqual(3);
    });

    it('adds a new record if no value matches with upsert set', async () => {
      await col.update('idx', '10', { b: 'updated' }, { upsert: true });
      const all = await col.getAll();
      expect(all.length).toEqual(4);
    });
  });
};
