import MemoryDb from './MemoryDb';
import contract from '../db.contract-test';

describe('MemoryDb', () => {
  contract({
    factory: (): MemoryDb => MemoryDb.connect('memory://?simulatedLatency=20'),
    testMigration: false,
  });

  it('shares data between databases with the same name', async () => {
    const db1 = MemoryDb.connect('memory://foo');
    const db2 = MemoryDb.connect('memory://foo');

    const col1 = db1.getCollection('test');
    const col2 = db2.getCollection('test');

    const stored = { id: '1', value: 'shared-value' };
    await col1.add(stored);

    const retrieved = await col2.get('id', stored.id);
    expect(retrieved).toEqual(stored);
  });

  it('does not share data between unnamed databases', async () => {
    const db1 = MemoryDb.connect('memory://');
    const db2 = MemoryDb.connect('memory://');

    const col1 = db1.getCollection('test');
    const col2 = db2.getCollection('test');

    const stored = { id: '1', value: 'solo-value' };
    await col1.add(stored);

    const retrieved = await col2.get('id', stored.id);
    expect(retrieved).toEqual(null);
  });
});
