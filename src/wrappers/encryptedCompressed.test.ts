import crypto from 'crypto';
import { encryptByKey, Encrypted } from './encrypted';
import { compress, Compressed } from './compressed';
import CollectionStorage from '../CollectionStorage';

interface TestType {
  id: string;
  data: string;
}

describe('compression + encryption', () => {
  const enc = encryptByKey(crypto.randomBytes(32));
  const data = 'this is a message which will be compressed and encrypted';

  it('stores and retrieves values transparently', async () => {
    const db = await CollectionStorage.connect('memory://');
    const col = compress(['data'], enc<Compressed<TestType, 'data'>>()(['data'], db.getCollection('compenc')));

    await col.add({ id: 'a', data });
    const value = await col.get('id', 'a');
    expect(value!.data).toEqual(data);
  });

  it('applies compression BEFORE encryption', async () => {
    const db = await CollectionStorage.connect('memory://');
    const backingCol = db.getCollection<Encrypted<Compressed<TestType, 'data'>, 'data'>>('compenc');
    const col = compress(['data'], enc<Compressed<TestType, 'data'>>()(['data'], backingCol));

    const longData = data + data + data + data + data + data;
    await col.add({ id: 'a', data: longData });

    const value = await col.get('id', 'a');
    const backingValue = await backingCol.get('id', 'a');
    expect(backingValue!.data.length).toBeLessThan(value!.data.length);
  });

  it('is not useful to apply compression AFTER encryption', async () => {
    const db = await CollectionStorage.connect('memory://');
    const backingCol = db.getCollection<Compressed<Encrypted<TestType, 'data'>, 'data'>>('compenc');
    // do not do it this way around!
    const col = enc<TestType>()(['data'], compress(['data'], backingCol));

    const longData = data + data + data + data + data + data;
    await col.add({ id: 'a', data: longData });

    const value = await col.get('id', 'a');
    const backingValue = await backingCol.get('id', 'a');
    expect(backingValue!.data.length).toBeGreaterThanOrEqual(value!.data.length);
  });
});
