import {
  contract,
  fromAsync,
  withCollection,
  withDB,
} from '../../test-helpers/db.contract-test.mts';
import { makeWrappedDB } from '../../test-helpers/makeWrappedDB.mts';
import type { Collection } from '../interfaces/Collection.mts';
import { MemoryDB } from '../memory/MemoryDB.mts';
import { compress, type Compressed } from './compressed.mts';
import 'lean-test';

interface TestType {
  id: string;
  uncompressed: number;
  uncompUnique: number;
  compressed: string;
}

describe('compression', () => {
  const db = withDB(() => MemoryDB.connect('memory://'));
  const backingCol = withCollection<Compressed<TestType, 'compressed'>>(
    db,
    { compressed: {}, uncompressed: {}, uncompUnique: { unique: true } },
    [],
  );
  const col = beforeEach<Collection<TestType>>(async ({ getTyped, setParameter }) => {
    const col = compress(['compressed'], getTyped(backingCol));
    setParameter(col);
    await col.add({ id: 'a', uncompressed: 4, uncompUnique: 4, compressed: 'hello world' });
  });

  it('stores and retrieves values transparently', { timeout: 5000 }, async ({ getTyped }) => {
    const value = await getTyped(col).where('id', 'a').get();
    expect(value!.compressed).toEqual('hello world');

    const backingValue = await getTyped(backingCol).where('id', 'a').get();
    expect(backingValue).toBeTruthy();
    expect(backingValue?.compressed).not(toEqual('hello world'));
  });

  it('reduces data size', { timeout: 5000 }, async ({ getTyped }) => {
    const data = 'this is a long message which should be easy to compress';
    const largeData = data + data + data + data + data;
    await getTyped(col).add({
      id: 'large',
      uncompressed: 5,
      uncompUnique: 5,
      compressed: largeData,
    });
    const value = await getTyped(col).where('id', 'large').get();
    const backingValue = await getTyped(backingCol).where('id', 'large').get();
    expect(backingValue!.compressed.length).toBeLessThan(value!.compressed.length);
  });

  it(
    'does not grow by much if compression is not feasible',
    { timeout: 5000 },
    async ({ getTyped }) => {
      await getTyped(col).add({
        id: 'small',
        uncompressed: 5,
        uncompUnique: 5,
        compressed: 'small message',
      });
      const value = await getTyped(col).where('id', 'small').get();
      const backingValue = await getTyped(backingCol).where('id', 'small').get();
      // grows by 1 byte to identify type, and 1 byte to identify no compression
      expect(backingValue!.compressed.length).toEqual(value!.compressed.length + 2);
    },
  );

  it('passes uncompressed data through when reading', { timeout: 5000 }, async ({ getTyped }) => {
    await getTyped(backingCol).add({
      id: 'small',
      uncompressed: 5,
      uncompUnique: 5,
      compressed: 'legacy message' as any,
    });
    const value = await getTyped(col).where('id', 'small').get();
    expect(value!.compressed).toEqual('legacy message');
  });

  it(
    'stores non-compressed values without modification',
    { timeout: 5000 },
    async ({ getTyped }) => {
      const value = await getTyped(col).where('id', 'a').get();
      expect(value!.id).toEqual('a');
      expect(value!.uncompressed).toEqual(4);

      const backingValue = await getTyped(backingCol).where('id', 'a').get();
      expect(backingValue!.id).toEqual('a');
      expect(backingValue!.uncompressed).toEqual(4);
    },
  );

  it('prevents filtering by compressed key', ({ getTyped }) => {
    expect(() => getTyped(col).where('compressed', 'foo')).throws('Cannot filter by wrapped value');
  });

  it('allows reading filtered columns', { timeout: 5000 }, async ({ getTyped }) => {
    const value = await getTyped(col)
      .where('uncompressed', 4)
      .attrs(['compressed', 'uncompressed'])
      .get();
    expect(value!.uncompressed).toEqual(4);
    expect(value!.compressed).toEqual('hello world');
    expect((value as any).id).toEqual(undefined);
  });

  it('allows getting all values', { timeout: 5000 }, async ({ getTyped }) => {
    const value = await fromAsync(getTyped(col).all().values());
    expect(value[0]?.compressed).toEqual('hello world');
  });
});

describe('compressed integration', () => {
  contract({
    factory: () =>
      makeWrappedDB(MemoryDB.connect('memory://'), (base) => compress(['value'], base)),
    testMigration: false,
  });
});
