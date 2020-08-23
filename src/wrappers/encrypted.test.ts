import crypto from 'crypto';
import {
  encryptByKey,
  encryptByRecord,
  encryptByRecordWithMasterKey,
  KeyRecord,
  Encrypted,
} from './encrypted';
import CollectionStorage from '../CollectionStorage';
import type { Collection } from '../interfaces/Collection';

interface TestType {
  id: string;
  unencrypted: number;
  unencUnique: number;
  encrypted: number;
}

type SerialisedKeyT = Buffer;

describe('encryption', () => {
  const rootKey = crypto.randomBytes(32);

  describe('encryptByKey', () => {
    let col: Collection<TestType>;
    let backingCol: Collection<Encrypted<TestType, 'encrypted'>>;

    beforeEach(async () => {
      const db = await CollectionStorage.connect('memory://');
      backingCol = db.getCollection('enc', {
        encrypted: {},
        unencrypted: {},
        unencUnique: { unique: true },
      });
      const enc = encryptByKey(rootKey);
      col = enc<TestType>()(['encrypted'], backingCol);

      await col.add({
        id: 'a',
        unencrypted: 4,
        unencUnique: 4,
        encrypted: 9,
      });
    });

    it('stores and retrieves values transparently', async () => {
      const value = await col.get('id', 'a');
      expect(value!.encrypted).toEqual(9);

      const backingValue = await backingCol.get('id', 'a');
      expect(backingValue!.encrypted).not.toEqual(9);
    });

    it('allows short-hand syntax without type safety', async () => {
      const enc = encryptByKey(rootKey) as any;
      const unsafeCol = enc(['encrypted'], backingCol);
      await unsafeCol.add({
        id: 'b',
        unencrypted: 5,
        unencUnique: 5,
        encrypted: 10,
      });

      const value = await unsafeCol.get('id', 'b');
      expect(value.encrypted).toEqual(10);
    });

    it('stores non-encrypted values without modification', async () => {
      const value = await col.get('id', 'a');
      expect(value!.id).toEqual('a');
      expect(value!.unencrypted).toEqual(4);

      const backingValue = await backingCol.get('id', 'a');
      expect(backingValue!.id).toEqual('a');
      expect(backingValue!.unencrypted).toEqual(4);
    });

    it('prevents reading by encrypted key', async () => {
      await expect(col.get('encrypted', 9)).rejects
        .toThrow('Cannot get by wrapped value');
    });

    it('allows reading filtered columns', async () => {
      const value = await col.get('unencrypted', 4, ['encrypted', 'unencrypted']);
      expect(value!.unencrypted).toEqual(4);
      expect(value!.encrypted).toEqual(9);
      expect((value as any).id).toEqual(undefined);
    });

    it('removes backing records when records are removed', async () => {
      await col.add({
        id: 'b',
        unencrypted: 4,
        unencUnique: 5,
        encrypted: 8,
      });
      await col.add({
        id: 'c',
        unencrypted: 5,
        unencUnique: 6,
        encrypted: 7,
      });

      await col.remove('unencrypted', 4);

      const records = await backingCol.getAll();
      expect(records.length).toEqual(1);
      expect(records[0].id).toEqual('c');
    });

    it('allows getting all values', async () => {
      const value = await col.getAll();
      expect(value[0].encrypted).toEqual(9);
    });
  });

  describe('encryptByKey value types', () => {
    it('supports JSON values', async () => {
      const record = { id: 1, value: { foo: ['a', { bar: 7 }] } };

      const db = await CollectionStorage.connect('memory://');
      const enc = encryptByKey(rootKey);
      const col = enc<typeof record>()(['value'], db.getCollection('enc'));

      await col.add(record);

      const value = await col.get('id', 1);
      expect(value).toEqual(record);
    });

    it('supports Buffer values', async () => {
      const record = { id: 1, value: Buffer.from('hello', 'utf8') };

      const db = await CollectionStorage.connect('memory://');
      const enc = encryptByKey(rootKey);
      const col = enc<typeof record>()(['value'], db.getCollection('enc'));

      await col.add(record);

      const value = await col.get('id', 1);
      expect([...value!.value]).toEqual([...record.value]);
    });

    it('forbids encrypting unique attributes', async () => {
      const record = { id: 1, value: '' };

      const db = await CollectionStorage.connect('memory://');
      const enc = encryptByKey(rootKey);
      expect(() => {
        enc<typeof record>()(['value'], db.getCollection('enc', { value: { unique: true } }));
      }).toThrow('Cannot wrap unique index value');
    });
  });

  describe('encryptByRecord', () => {
    let col: Collection<TestType>;
    let keyCol: Collection<KeyRecord<string, SerialisedKeyT>>;
    let backingCol: Collection<Encrypted<TestType, 'encrypted'>>;

    beforeEach(async () => {
      const db = await CollectionStorage.connect('memory://');
      keyCol = db.getCollection('keys');
      backingCol = db.getCollection('enc', {
        encrypted: {},
        unencrypted: {},
        unencUnique: { unique: true },
      });
      const enc = encryptByRecord(keyCol);
      col = enc<TestType>()(['encrypted'], backingCol);

      await col.add({
        id: 'a',
        unencrypted: 4,
        unencUnique: 4,
        encrypted: 9,
      });
    });

    it('stores and retrieves values transparently', async () => {
      const value = await col.get('id', 'a');
      expect(value!.encrypted).toEqual(9);

      const backingValue = await backingCol.get('id', 'a');
      expect(backingValue!.encrypted).not.toEqual(9);
    });

    it('stores per-entry keys in the provided key table', async () => {
      await col.add({
        id: 'b',
        unencrypted: 5,
        unencUnique: 5,
        encrypted: 8,
      });

      const valueA = await keyCol.get('id', 'a');
      expect(valueA).toBeTruthy();
      expect(valueA!.key).toBeTruthy();

      const valueB = await keyCol.get('id', 'b');
      expect(valueB).toBeTruthy();
      expect(valueB!.key).toBeTruthy();

      expect(valueA!.key).not.toEqual(valueB!.key);
    });

    it('does not cache keys by default', async () => {
      await keyCol.remove('id', 'a');

      await expect(col.get('id', 'a')).rejects
        .toHaveProperty('message', 'No encryption key found for record');
    });

    it('caches keys if requested', async () => {
      const enc = encryptByRecord(keyCol, { keyCache: { capacity: 1 } });
      col = enc<TestType>()(['encrypted'], backingCol);

      await col.get('id', 'a');
      await keyCol.remove('id', 'a');

      const value = await col.get('id', 'a');
      expect(value!.encrypted).toEqual(9);
    });

    it('stores non-encrypted values without modification', async () => {
      const value = await col.get('id', 'a');
      expect(value!.id).toEqual('a');
      expect(value!.unencrypted).toEqual(4);

      const backingValue = await backingCol.get('id', 'a');
      expect(backingValue!.id).toEqual('a');
      expect(backingValue!.unencrypted).toEqual(4);
    });

    it('prevents reading by encrypted key', async () => {
      await expect(col.get('encrypted', 9)).rejects
        .toThrow('Cannot get by wrapped value');
    });

    it('prevents reading filtered columns without id', async () => {
      await expect(col.get('unencrypted', 4, ['encrypted'])).rejects
        .toThrow('Must provide ID for encryption');
    });

    it('removes backing records and keys when records are removed', async () => {
      await col.add({
        id: 'b',
        unencrypted: 4,
        unencUnique: 5,
        encrypted: 8,
      });
      await col.add({
        id: 'c',
        unencrypted: 5,
        unencUnique: 6,
        encrypted: 7,
      });

      await col.remove('unencrypted', 4);

      const keys = await keyCol.getAll();
      expect(keys.length).toEqual(1);
      expect(keys[0].id).toEqual('c');

      const records = await backingCol.getAll();
      expect(records.length).toEqual(1);
      expect(records[0].id).toEqual('c');
    });

    it('allows getting all values', async () => {
      const value = await col.getAll();
      expect(value[0].encrypted).toEqual(9);
    });
  });

  describe('encryptByRecord value types', () => {
    interface CheckT {
      id: string;
      value: unknown;
    }

    let col: Collection<CheckT>;

    beforeEach(async () => {
      const db = await CollectionStorage.connect('memory://');
      const keyCol = db.getCollection<KeyRecord<string, SerialisedKeyT>>('keys');
      col = encryptByRecord(keyCol)<CheckT>()(['value'], db.getCollection('enc'));
    });

    it('supports JSON values', async () => {
      const record = { id: 'a', value: { foo: ['a', { bar: 7 }] } };

      await col.add(record);
      const value = await col.get('id', 'a');
      expect(value).toEqual(record);
    });

    it('supports Buffer values', async () => {
      const record = { id: 'a', value: Buffer.from('hello', 'utf8') };

      await col.add(record);
      const value = await col.get('id', 'a');
      expect([...value!.value as Buffer]).toEqual([...record.value]);
    });
  });

  describe('encryptByRecordWithMasterKey', () => {
    let col: Collection<TestType>;
    let keyCol: Collection<KeyRecord<string, SerialisedKeyT>>;
    let backingCol: Collection<Encrypted<TestType, 'encrypted'>>;

    beforeEach(async () => {
      const db = await CollectionStorage.connect('memory://');
      keyCol = db.getCollection('keys');
      backingCol = db.getCollection('enc', {
        encrypted: {},
        unencrypted: {},
        unencUnique: { unique: true },
      });
      const enc = encryptByRecordWithMasterKey(rootKey, keyCol);
      col = enc<TestType>()(['encrypted'], backingCol);

      await col.add({
        id: 'a',
        unencrypted: 4,
        unencUnique: 4,
        encrypted: 9,
      });
    });

    it('stores and retrieves values transparently', async () => {
      const value = await col.get('id', 'a');
      expect(value!.encrypted).toEqual(9);

      const backingValue = await backingCol.get('id', 'a');
      expect(backingValue!.encrypted).not.toEqual(9);
    });

    it('stores per-entry keys in the provided key table', async () => {
      await col.add({
        id: 'b',
        unencrypted: 5,
        unencUnique: 5,
        encrypted: 8,
      });

      const valueA = await keyCol.get('id', 'a');
      expect(valueA).toBeTruthy();
      expect(valueA!.key).toBeTruthy();

      const valueB = await keyCol.get('id', 'b');
      expect(valueB).toBeTruthy();
      expect(valueB!.key).toBeTruthy();

      expect(valueA!.key).not.toEqual(valueB!.key);
    });

    it('does not load keys if no encrypted column is written', async () => {
      await col.update('id', 'b', {
        unencrypted: 5,
        unencUnique: 5,
      }, { upsert: true });

      const keyValue = await keyCol.get('id', 'b');
      expect(keyValue).not.toBeTruthy();
    });

    it('does not load keys if no encrypted column is requested', async () => {
      // copy backing item without copying key
      const item = await backingCol.get('id', 'a');
      await backingCol.add({ ...item!, id: 'b', unencUnique: 5 });

      const value = await col.get('id', 'b', ['id', 'unencrypted']);
      expect(value!.unencrypted).toEqual(4);

      const keyValue = await keyCol.get('id', 'b');
      expect(keyValue).not.toBeTruthy();
    });

    it('throws if the requested record does not have a key', async () => {
      // copy backing item without copying key
      const item = await backingCol.get('id', 'a');
      await backingCol.add({ ...item!, id: 'b', unencUnique: 5 });

      await expect(col.get('id', 'b', ['id', 'encrypted'])).rejects
        .toThrow('No encryption key found for record');
    });

    it('throws if the requested record has corrupted data', async () => {
      await backingCol.update('id', 'a', {
        encrypted: Buffer.from('nope', 'utf8'),
      });

      await expect(col.get('id', 'a')).rejects
        .toThrow('Unknown encryption algorithm');
    });

    it('stores non-encrypted values without modification', async () => {
      const value = await col.get('id', 'a');
      expect(value!.id).toEqual('a');
      expect(value!.unencrypted).toEqual(4);

      const backingValue = await backingCol.get('id', 'a');
      expect(backingValue!.id).toEqual('a');
      expect(backingValue!.unencrypted).toEqual(4);
    });

    it('allows updating by id', async () => {
      await col.update('id', 'a', { encrypted: 8 });

      const value = await col.get('id', 'a');
      expect(value!.encrypted).toEqual(8);
    });

    it('allows updating with id', async () => {
      await col.update('unencUnique', 4, { id: 'a', encrypted: 8 });

      const value = await col.get('id', 'a');
      expect(value!.encrypted).toEqual(8);
    });

    it('allows upserting with id', async () => {
      await col.update('id', 'b', {
        encrypted: 8,
        unencUnique: 5,
      }, { upsert: true });

      const value = await col.get('id', 'b');
      expect(value!.encrypted).toEqual(8);
    });

    it('rejects updating without id', async () => {
      await expect(col.update('unencrypted', 4, { encrypted: 8 })).rejects
        .toThrow('Must provide ID for encryption');
    });

    it('rejects upserting without id', async () => {
      await expect(col.update('unencrypted', 4, {
        encrypted: 8,
        unencUnique: 5,
      }, { upsert: true })).rejects
        .toThrow('Must provide ID for encryption');
    });

    it('prevents reading by encrypted key', async () => {
      await expect(col.get('encrypted', 9)).rejects
        .toThrow('Cannot get by wrapped value');
    });

    it('prevents reading filtered columns without id', async () => {
      await expect(col.get('unencrypted', 4, ['encrypted'])).rejects
        .toThrow('Must provide ID for encryption');
    });

    it('allows reading filtered columns with id', async () => {
      const value = await col.get('unencrypted', 4, ['id', 'encrypted']);
      expect(value!.encrypted).toEqual(9);
    });

    it('allows reading filtered columns if queried by id', async () => {
      const value = await col.get('id', 'a', ['encrypted']);
      expect(value!.encrypted).toEqual(9);
    });

    it('prevents reading filtered columns without id (getAll)', async () => {
      await expect(col.getAll('unencrypted', 4, ['encrypted'])).rejects
        .toThrow('Must provide ID for encryption');
    });

    it('allows reading filtered columns with id (getAll)', async () => {
      const value = await col.getAll('unencrypted', 4, ['id', 'encrypted']);
      expect(value[0].encrypted).toEqual(9);
    });

    it('allows reading filtered columns if queried by id (getAll)', async () => {
      const value = await col.getAll('id', 'a', ['encrypted']);
      expect(value[0].encrypted).toEqual(9);
    });

    it('allows getting all values', async () => {
      const value = await col.getAll();
      expect(value[0].encrypted).toEqual(9);
    });

    /* eslint-disable-next-line jest/expect-expect */ // this test is mostly compilation
    it('infers types', async () => {
      const db = await CollectionStorage.connect('memory://');
      encryptByRecordWithMasterKey(
        rootKey,
        db.getCollection('keys'),
      )<TestType>()(['encrypted'], db.getCollection('enc'));
    });
  });
});
