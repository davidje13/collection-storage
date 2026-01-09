import { randomBytes } from 'node:crypto';
import { MemoryDB } from '../memory/MemoryDB.mts';
import { encryptByKey, type Encrypted } from './encrypted.mts';
import { compress, type Compressed } from './compressed.mts';
import 'lean-test';

interface TestType {
  id: string;
  data: string;
}

describe('compress + encrypt', () => {
  const enc = encryptByKey(randomBytes(32));
  const data = 'this is a message which will be compressed and encrypted';

  it('stores and retrieves values transparently', { timeout: 5000 }, async () => {
    const db = MemoryDB.connect('memory://');
    const col = compress(
      ['data'],
      enc<Compressed<TestType, 'data'>>()(['data'], db.getCollection('compenc')),
    );

    await col.add({ id: 'a', data });
    const value = await col.where('id', 'a').get();
    expect(value!.data).toEqual(data);
  });

  it('applies compression BEFORE encryption', { timeout: 5000 }, async () => {
    const db = MemoryDB.connect('memory://');
    const backingCol = db.getCollection<Encrypted<Compressed<TestType, 'data'>, 'data'>>('compenc');
    const col = compress(['data'], enc<Compressed<TestType, 'data'>>()(['data'], backingCol));

    const longData = data + data + data + data + data + data;
    await col.add({ id: 'a', data: longData });

    const value = await col.where('id', 'a').get();
    const backingValue = await backingCol.where('id', 'a').get();
    expect(backingValue!.data.length).toBeLessThan(value!.data.length);
  });

  it('is not useful to apply compression AFTER encryption', { timeout: 5000 }, async () => {
    const db = MemoryDB.connect('memory://');
    const backingCol = db.getCollection<Compressed<Encrypted<TestType, 'data'>, 'data'>>('compenc');
    // do not do it this way around!
    const col = enc<TestType>()(['data'], compress(['data'], backingCol));

    const longData = data + data + data + data + data + data;
    await col.add({ id: 'a', data: longData });

    const value = await col.where('id', 'a').get();
    const backingValue = await backingCol.where('id', 'a').get();
    expect(backingValue!.data.length).toBeGreaterThanOrEqual(value!.data.length);
  });
});
