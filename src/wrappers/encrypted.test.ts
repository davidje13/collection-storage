import crypto from 'crypto';
import {
  encryptByKey,
  encryptByRecord,
  encryptByRecordWithMasterKey,
  KeyRecord,
} from './encrypted';
import { Wrapped } from './WrappedCollection';
import CollectionStorage from '../CollectionStorage';
import Collection from '../Collection';

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

      await expect(col.get('encrypted', 9)).rejects.toThrow();
    });

    it('allows reading filtered columns', async () => {
      await col.add({ id: 'a', unencrypted: 4, encrypted: 9 });

      const value = await col.get('unencrypted', 4, ['encrypted', 'unencrypted']);
      expect(value!.unencrypted).toEqual(4);
      expect(value!.encrypted).toEqual(9);
      expect((value as any).id).toEqual(undefined);
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

      await expect(col.get('encrypted', 9)).rejects.toThrow();
    });

    it('prevents reading filtered columns without id', async () => {
      await col.add({ id: 'a', unencrypted: 4, encrypted: 9 });

      await expect(col.get('unencrypted', 4, ['unencrypted'])).rejects.toThrow();
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

      await expect(col.get('encrypted', 9)).rejects.toThrow();
    });

    it('prevents reading filtered columns without id', async () => {
      await col.add({ id: 'a', unencrypted: 4, encrypted: 9 });

      await expect(col.get('unencrypted', 4, ['unencrypted'])).rejects.toThrow();
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
