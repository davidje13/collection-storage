import { MemoryDB } from './MemoryDB.mts';
import { contract } from '../../test-helpers/db.contract-test.mts';
import 'lean-test';

describe('MemoryDB', () => {
  let unique = 0;

  contract({
    factory: (persist) => {
      const id = persist ? `db-${unique++}` : '';
      return MemoryDB.connect(`memory://${id}`);
    },
    migrationFactory: (existing) => MemoryDB.connect(`memory://${existing.databaseName}`),
  });

  it('shares data between databases with the same name', { timeout: 5000 }, async () => {
    const db1 = MemoryDB.connect('memory://foo');
    const db2 = MemoryDB.connect('memory://foo');

    const col1 = db1.getCollection('test');
    const col2 = db2.getCollection('test');

    const stored = { id: '1', value: 'shared-value' };
    await col1.add(stored);

    const retrieved = await col2.where('id', stored.id).get();
    expect(retrieved).toEqual(stored);
  });

  it(
    'does not share data between named databases with different names',
    { timeout: 5000 },
    async () => {
      const db1 = MemoryDB.connect('memory://one');
      const db2 = MemoryDB.connect('memory://two');

      const col1 = db1.getCollection('test');
      const col2 = db2.getCollection('test');

      const stored = { id: '1', value: 'solo-value' };
      await col1.add(stored);

      const retrieved = await col2.where('id', stored.id).get();
      expect(retrieved).toEqual(null);
    },
  );

  it('does not share data between unnamed databases', { timeout: 5000 }, async () => {
    const db1 = MemoryDB.connect('memory://');
    const db2 = MemoryDB.connect('memory://');

    const col1 = db1.getCollection('test');
    const col2 = db2.getCollection('test');

    const stored = { id: '1', value: 'solo-value' };
    await col1.add(stored);

    const retrieved = await col2.where('id', stored.id).get();
    expect(retrieved).toEqual(null);
  });
});

describe('MemoryDB with simulated latency', () => {
  let unique = 0;

  contract({
    factory: (persist) => {
      const id = persist ? `db-latency-${unique++}` : '';
      return MemoryDB.connect(`memory://${id}?simulatedLatency=20`);
    },
    migrationFactory: (existing) =>
      MemoryDB.connect(`memory://${existing.databaseName}?simulatedLatency=20`),
  });
});
