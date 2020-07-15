import { compress } from './compressed';
import type { Wrapped } from './WrappedCollection';
import CollectionStorage from '../CollectionStorage';
import type { Collection } from '../interfaces/Collection';
import type { IDable } from '../interfaces/IDable';

interface TestType {
  id: string;
  uncompressed: number;
  uncompUnique: number;
  compressed: string;
}

type Compressed<T extends IDable, WF extends keyof T> = Wrapped<T, WF, Buffer>;

describe('compression', () => {
  let col: Collection<TestType>;
  let backingCol: Collection<Compressed<TestType, 'compressed'>>;

  beforeEach(async () => {
    const db = await CollectionStorage.connect('memory://');
    backingCol = db.getCollection('comp', {
      compressed: {},
      uncompressed: {},
      uncompUnique: { unique: true },
    });
    col = compress(['compressed'], backingCol);

    await col.add({
      id: 'a',
      uncompressed: 4,
      uncompUnique: 4,
      compressed: 'hello world',
    });
  });

  it('stores and retrieves values transparently', async () => {
    const value = await col.get('id', 'a');
    expect(value!.compressed).toEqual('hello world');

    const backingValue = await backingCol.get('id', 'a');
    expect(backingValue!.compressed).not.toEqual('hello world');
  });

  it('reduces data size', async () => {
    const data = 'this is a long message which should be easy to compress';
    const largeData = data + data + data + data + data;
    await col.add({
      id: 'large',
      uncompressed: 5,
      uncompUnique: 5,
      compressed: largeData,
    });
    const value = await col.get('id', 'large');
    const backingValue = await backingCol.get('id', 'large');
    expect(backingValue!.compressed.length).toBeLessThan(value!.compressed.length);
  });

  it('does not grow by much if compression is not feasible', async () => {
    await col.add({
      id: 'small',
      uncompressed: 5,
      uncompUnique: 5,
      compressed: 'small message',
    });
    const value = await col.get('id', 'small');
    const backingValue = await backingCol.get('id', 'small');
    // grows by 1 byte to identify type, and 1 byte to identify no compression
    expect(backingValue!.compressed.length).toEqual(value!.compressed.length + 2);
  });

  it('passes uncompressed data through when reading', async () => {
    await backingCol.add({
      id: 'small',
      uncompressed: 5,
      uncompUnique: 5,
      compressed: 'legacy message' as any,
    });
    const value = await col.get('id', 'small');
    expect(value!.compressed).toEqual('legacy message');
  });

  it('stores non-compressed values without modification', async () => {
    const value = await col.get('id', 'a');
    expect(value!.id).toEqual('a');
    expect(value!.uncompressed).toEqual(4);

    const backingValue = await backingCol.get('id', 'a');
    expect(backingValue!.id).toEqual('a');
    expect(backingValue!.uncompressed).toEqual(4);
  });

  it('prevents reading by compressed key', async () => {
    await expect(col.get('compressed', 'foo')).rejects
      .toThrow('Cannot get by wrapped value');
  });

  it('allows reading filtered columns', async () => {
    const value = await col.get('uncompressed', 4, ['compressed', 'uncompressed']);
    expect(value!.uncompressed).toEqual(4);
    expect(value!.compressed).toEqual('hello world');
    expect((value as any).id).toEqual(undefined);
  });

  it('allows getting all values', async () => {
    const value = await col.getAll();
    expect(value[0].compressed).toEqual('hello world');
  });
});
