import crypto from 'crypto';
import {
  encryptByKey,
  encryptByRecord,
  encryptByRecordWithMasterKey,
  KeyRecord,
} from './encrypted';
import { Wrapped } from './WrappedCollection';
import CollectionStorage from '../CollectionStorage';
import Collection from '../interfaces/Collection';

interface TestType {
  id: string;
  unencrypted: number;
  encrypted: number;
}

describe('encryption', () => {
  const rootKey = crypto.randomBytes(32).toString('base64');

  describe('encryptByKey', () => {
    let col: Collection<TestType>;
    let backingCol: Collection<Wrapped<TestType, 'encrypted', string>>;

    beforeEach(async () => {
      const db = await CollectionStorage.connect('memory://');
      backingCol = db.getCollection('enc', { encrypted: {}, unencrypted: {} });
      const enc = encryptByKey<TestType>(rootKey);
      col = enc(['encrypted'], backingCol);
    });

    it('stores and retrieves values transparently', async () => {
      await col.add({ id: 'a', unencrypted: 4, encrypted: 9 });

      const value = await col.get('id', 'a');
      expect(value!.encrypted).toEqual(9);

      const backingValue = await backingCol.get('id', 'a');
      expect(backingValue!.encrypted).not.toEqual(9);
    });

    it('stores non-encrypted values without modification', async () => {
      await col.add({ id: 'a', unencrypted: 4, encrypted: 9 });

      const value = await col.get('id', 'a');
      expect(value!.id).toEqual('a');
      expect(value!.unencrypted).toEqual(4);

      const backingValue = await backingCol.get('id', 'a');
      expect(backingValue!.id).toEqual('a');
      expect(backingValue!.unencrypted).toEqual(4);
    });

    it('prevents reading by encrypted key', async () => {
      await col.add({ id: 'a', unencrypted: 4, encrypted: 9 });

      await expect(col.get('encrypted', 9)).rejects
        .toThrow('Cannot get by encrypted value');
    });

    it('allows reading filtered columns', async () => {
      await col.add({ id: 'a', unencrypted: 4, encrypted: 9 });

      const value = await col.get('unencrypted', 4, ['encrypted', 'unencrypted']);
      expect(value!.unencrypted).toEqual(4);
      expect(value!.encrypted).toEqual(9);
      expect((value as any).id).toEqual(undefined);
    });

    it('removes backing records when records are removed', async () => {
      await col.add({ id: 'a', unencrypted: 4, encrypted: 9 });
      await col.add({ id: 'b', unencrypted: 4, encrypted: 8 });
      await col.add({ id: 'c', unencrypted: 5, encrypted: 7 });

      await col.remove('unencrypted', 4);

      const records = await backingCol.getAll();
      expect(records.length).toEqual(1);
      expect(records[0].id).toEqual('c');
    });

    it('allows getting all values', async () => {
      await col.add({ id: 'a', unencrypted: 4, encrypted: 9 });

      const value = await col.getAll();
      expect(value[0].encrypted).toEqual(9);
    });
  });

  describe('encryptByRecord', () => {
    let col: Collection<TestType>;
    let keyCol: Collection<KeyRecord<string>>;
    let backingCol: Collection<Wrapped<TestType, 'encrypted', string>>;

    beforeEach(async () => {
      const db = await CollectionStorage.connect('memory://');
      keyCol = db.getCollection('keys');
      backingCol = db.getCollection('enc', { encrypted: {}, unencrypted: {} });
      const enc = encryptByRecord<TestType>(keyCol);
      col = enc(['encrypted'], backingCol);
    });

    it('stores and retrieves values transparently', async () => {
      await col.add({ id: 'a', unencrypted: 4, encrypted: 9 });

      const value = await col.get('id', 'a');
      expect(value!.encrypted).toEqual(9);

      const backingValue = await backingCol.get('id', 'a');
      expect(backingValue!.encrypted).not.toEqual(9);
    });

    it('stores per-entry keys in the provided key table', async () => {
      await col.add({ id: 'a', unencrypted: 4, encrypted: 9 });
      await col.add({ id: 'b', unencrypted: 5, encrypted: 8 });

      const valueA = await keyCol.get('id', 'a');
      expect(valueA).toBeTruthy();
      expect(valueA!.key).toBeTruthy();

      const valueB = await keyCol.get('id', 'b');
      expect(valueB).toBeTruthy();
      expect(valueB!.key).toBeTruthy();

      expect(valueA!.key).not.toEqual(valueB!.key);
    });

    it('stores non-encrypted values without modification', async () => {
      await col.add({ id: 'a', unencrypted: 4, encrypted: 9 });

      const value = await col.get('id', 'a');
      expect(value!.id).toEqual('a');
      expect(value!.unencrypted).toEqual(4);

      const backingValue = await backingCol.get('id', 'a');
      expect(backingValue!.id).toEqual('a');
      expect(backingValue!.unencrypted).toEqual(4);
    });

    it('prevents reading by encrypted key', async () => {
      await col.add({ id: 'a', unencrypted: 4, encrypted: 9 });

      await expect(col.get('encrypted', 9)).rejects
        .toThrow('Cannot get by encrypted value');
    });

    it('prevents reading filtered columns without id', async () => {
      await col.add({ id: 'a', unencrypted: 4, encrypted: 9 });

      await expect(col.get('unencrypted', 4, ['encrypted'])).rejects
        .toThrow('Must provide ID for encryption');
    });

    it('removes backing records and keys when records are removed', async () => {
      await col.add({ id: 'a', unencrypted: 4, encrypted: 9 });
      await col.add({ id: 'b', unencrypted: 4, encrypted: 8 });
      await col.add({ id: 'c', unencrypted: 5, encrypted: 7 });

      await col.remove('unencrypted', 4);

      const keys = await keyCol.getAll();
      expect(keys.length).toEqual(1);
      expect(keys[0].id).toEqual('c');

      const records = await backingCol.getAll();
      expect(records.length).toEqual(1);
      expect(records[0].id).toEqual('c');
    });

    it('allows getting all values', async () => {
      await col.add({ id: 'a', unencrypted: 4, encrypted: 9 });

      const value = await col.getAll();
      expect(value[0].encrypted).toEqual(9);
    });
  });

  describe('encryptByRecordWithMasterKey', () => {
    let col: Collection<TestType>;
    let keyCol: Collection<KeyRecord<string>>;
    let backingCol: Collection<Wrapped<TestType, 'encrypted', string>>;

    beforeEach(async () => {
      const db = await CollectionStorage.connect('memory://');
      keyCol = db.getCollection('keys');
      backingCol = db.getCollection('enc', { encrypted: {}, unencrypted: {} });
      const enc = encryptByRecordWithMasterKey<TestType>(rootKey, keyCol);
      col = enc(['encrypted'], backingCol);
    });

    it('stores and retrieves values transparently', async () => {
      await col.add({ id: 'a', unencrypted: 4, encrypted: 9 });

      const value = await col.get('id', 'a');
      expect(value!.encrypted).toEqual(9);

      const backingValue = await backingCol.get('id', 'a');
      expect(backingValue!.encrypted).not.toEqual(9);
    });

    it('stores per-entry keys in the provided key table', async () => {
      await col.add({ id: 'a', unencrypted: 4, encrypted: 9 });
      await col.add({ id: 'b', unencrypted: 5, encrypted: 8 });

      const valueA = await keyCol.get('id', 'a');
      expect(valueA).toBeTruthy();
      expect(valueA!.key).toBeTruthy();

      const valueB = await keyCol.get('id', 'b');
      expect(valueB).toBeTruthy();
      expect(valueB!.key).toBeTruthy();

      expect(valueA!.key).not.toEqual(valueB!.key);
    });

    it('does not load keys if no encrypted column is written', async () => {
      await col.update('id', 'a', { unencrypted: 4 }, { upsert: true });

      const keyValue = await keyCol.get('id', 'a');
      expect(keyValue).not.toBeTruthy();
    });

    it('does not load keys if no encrypted column is requested', async () => {
      await backingCol.add({ id: 'a', unencrypted: 4, encrypted: 'meh' });

      const value = await col.get('id', 'a', ['id', 'unencrypted']);
      expect(value!.unencrypted).toEqual(4);

      const keyValue = await keyCol.get('id', 'a');
      expect(keyValue).not.toBeTruthy();
    });

    it('throws if the requested record does not have a key', async () => {
      await col.add({ id: 'a', unencrypted: 4, encrypted: 9 });

      // copy backing item without copying key
      const item = await backingCol.get('id', 'a');
      await backingCol.add({ ...item!, id: 'b' });

      await expect(col.get('id', 'b', ['id', 'encrypted'])).rejects
        .toThrow('No encryption key found for record');
    });

    it('throws if the requested record has corrupted data', async () => {
      await col.add({ id: 'a', unencrypted: 4, encrypted: 9 });
      await backingCol.update('id', 'a', { encrypted: 'nope' });

      await expect(col.get('id', 'a')).rejects
        .toThrow('Unknown encryption algorithm');
    });

    it('stores non-encrypted values without modification', async () => {
      await col.add({ id: 'a', unencrypted: 4, encrypted: 9 });

      const value = await col.get('id', 'a');
      expect(value!.id).toEqual('a');
      expect(value!.unencrypted).toEqual(4);

      const backingValue = await backingCol.get('id', 'a');
      expect(backingValue!.id).toEqual('a');
      expect(backingValue!.unencrypted).toEqual(4);
    });

    it('allows updating by id', async () => {
      await col.add({ id: 'a', unencrypted: 4, encrypted: 9 });
      await col.update('id', 'a', { encrypted: 8 });

      const value = await col.get('id', 'a');
      expect(value!.encrypted).toEqual(8);
    });

    it('allows updating with id', async () => {
      await col.add({ id: 'a', unencrypted: 4, encrypted: 9 });
      await col.update('unencrypted', 4, { id: 'a', encrypted: 8 });

      const value = await col.get('id', 'a');
      expect(value!.encrypted).toEqual(8);
    });

    it('allows upserting with id', async () => {
      await col.update('id', 'a', { encrypted: 8 }, { upsert: true });

      const value = await col.get('id', 'a');
      expect(value!.encrypted).toEqual(8);
    });

    it('rejects updating without id', async () => {
      await col.add({ id: 'a', unencrypted: 4, encrypted: 9 });
      await expect(col.update('unencrypted', 4, { encrypted: 8 })).rejects
        .toThrow('Must provide ID for encryption');
    });

    it('rejects upserting without id', async () => {
      await expect(col.update('unencrypted', 4, { encrypted: 8 }, { upsert: true })).rejects
        .toThrow('Must provide ID for encryption');
    });

    it('prevents reading by encrypted key', async () => {
      await col.add({ id: 'a', unencrypted: 4, encrypted: 9 });

      await expect(col.get('encrypted', 9)).rejects
        .toThrow('Cannot get by encrypted value');
    });

    it('prevents reading filtered columns without id', async () => {
      await col.add({ id: 'a', unencrypted: 4, encrypted: 9 });

      await expect(col.get('unencrypted', 4, ['encrypted'])).rejects
        .toThrow('Must provide ID for encryption');
    });

    it('allows reading filtered columns with id', async () => {
      await col.add({ id: 'a', unencrypted: 4, encrypted: 9 });

      const value = await col.get('unencrypted', 4, ['id', 'encrypted']);
      expect(value!.encrypted).toEqual(9);
    });

    it('allows reading filtered columns if queried by id', async () => {
      await col.add({ id: 'a', unencrypted: 4, encrypted: 9 });

      const value = await col.get('id', 'a', ['encrypted']);
      expect(value!.encrypted).toEqual(9);
    });

    it('prevents reading filtered columns without id (getAll)', async () => {
      await col.add({ id: 'a', unencrypted: 4, encrypted: 9 });

      await expect(col.getAll('unencrypted', 4, ['encrypted'])).rejects
        .toThrow('Must provide ID for encryption');
    });

    it('allows reading filtered columns with id (getAll)', async () => {
      await col.add({ id: 'a', unencrypted: 4, encrypted: 9 });

      const value = await col.getAll('unencrypted', 4, ['id', 'encrypted']);
      expect(value[0].encrypted).toEqual(9);
    });

    it('allows reading filtered columns if queried by id (getAll)', async () => {
      await col.add({ id: 'a', unencrypted: 4, encrypted: 9 });

      const value = await col.getAll('id', 'a', ['encrypted']);
      expect(value[0].encrypted).toEqual(9);
    });

    it('allows getting all values', async () => {
      await col.add({ id: 'a', unencrypted: 4, encrypted: 9 });

      const value = await col.getAll();
      expect(value[0].encrypted).toEqual(9);
    });

    it('infers types', async () => {
      const db = await CollectionStorage.connect('memory://');
      encryptByRecordWithMasterKey<TestType>(
        rootKey,
        db.getCollection('keys'),
      )(
        ['encrypted'],
        db.getCollection('enc'),
      );
    });
  });
});
