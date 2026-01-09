import { randomBytes } from 'node:crypto';
import {
  contract,
  fromAsync,
  withCollection,
  withDB,
} from '../../test-helpers/db.contract-test.mts';
import { makeWrappedDB } from '../../test-helpers/makeWrappedDB.mts';
import type { Collection } from '../interfaces/Collection.mts';
import type { IDable } from '../interfaces/IDable.mts';
import { MemoryDB } from '../memory/MemoryDB.mts';
import {
  encryptByKey,
  encryptByRecord,
  encryptByRecordWithMasterKey,
  type KeyRecord,
  type Encrypted,
} from './encrypted.mts';
import 'lean-test';

interface TestType {
  id: string;
  unencrypted: number;
  unencUnique: number;
  encrypted: number;
}

interface SecurityTestType {
  id: string;
  __proto__: string;
  benign: string;
}

type SerialisedKeyT = Buffer;

describe('encrypt', () => {
  const db = withDB(() => MemoryDB.connect('memory://'));
  const rootKey = randomBytes(32);

  describe('security', () => {
    it('handles encrypted malicious attribute names', { timeout: 5000 }, async ({ getTyped }) => {
      const enc = encryptByKey(rootKey);
      const col = enc<SecurityTestType>()(['__proto__'], getTyped(db).getCollection('enc'));

      await col.add(JSON.parse('{"id":"a","__proto__":"foo","benign":"a"}'));
      const value = await col.where('id', 'a').get();
      expect(value!.__proto__).toEqual('foo');
      expect((value as any).length).toBeUndefined();
    });

    it(
      'handles non-encrypted malicious attribute names',
      { timeout: 5000 },
      async ({ getTyped }) => {
        const enc = encryptByKey(rootKey);
        const col = enc<SecurityTestType>()(['benign'], getTyped(db).getCollection('enc'));

        await col.add(JSON.parse('{"id":"a","__proto__":"foo","benign":"a"}'));
        const value = await col.where('id', 'a').get();
        expect(value!.__proto__).toEqual('foo');
        expect((value as any).length).toBeUndefined();
      },
    );
  });

  describe('encryptByKey', () => {
    const backingCol = withCollection<Encrypted<TestType, 'encrypted'>>(db, {
      keys: { encrypted: {}, unencrypted: {}, unencUnique: { unique: true } },
    });
    const col = beforeEach<Collection<TestType>>(async ({ getTyped, setParameter }) => {
      const enc = encryptByKey(rootKey);
      const col = enc<TestType>()(['encrypted'], getTyped(backingCol));
      setParameter(col);
      await col.add({ id: 'a', unencrypted: 4, unencUnique: 4, encrypted: 9 });
    });

    it('stores and retrieves values transparently', { timeout: 5000 }, async ({ getTyped }) => {
      const value = await getTyped(col).where('id', 'a').get();
      expect(value!.encrypted).toEqual(9);

      const backingValue = await getTyped(backingCol).where('id', 'a').get();
      expect(backingValue!.encrypted).not(toEqual(9));
    });

    it('allows short-hand syntax without type safety', { timeout: 5000 }, async ({ getTyped }) => {
      const enc = encryptByKey(rootKey) as any;
      const unsafeCol = enc(['encrypted'], getTyped(backingCol));
      await unsafeCol.add({
        id: 'b',
        unencrypted: 5,
        unencUnique: 5,
        encrypted: 10,
      });

      const value = await unsafeCol.where('id', 'b').get();
      expect(value.encrypted).toEqual(10);
    });

    it(
      'stores non-encrypted values without modification',
      { timeout: 5000 },
      async ({ getTyped }) => {
        const value = await getTyped(col).where('id', 'a').get();
        expect(value!.id).toEqual('a');
        expect(value!.unencrypted).toEqual(4);

        const backingValue = await getTyped(backingCol).where('id', 'a').get();
        expect(backingValue!.id).toEqual('a');
        expect(backingValue!.unencrypted).toEqual(4);
      },
    );

    it('prevents filtering by encrypted key', ({ getTyped }) => {
      expect(() => getTyped(col).where('encrypted', 9)).throws('Cannot filter by wrapped value');
    });

    it('allows reading filtered columns', { timeout: 5000 }, async ({ getTyped }) => {
      const value = await getTyped(col)
        .where('unencrypted', 4)
        .attrs(['encrypted', 'unencrypted'])
        .get();
      expect(value!.unencrypted).toEqual(4);
      expect(value!.encrypted).toEqual(9);
      expect((value as any).id).toEqual(undefined);
    });

    it(
      'removes backing records when records are removed',
      { timeout: 5000 },
      async ({ getTyped }) => {
        await getTyped(col).add(
          { id: 'b', unencrypted: 4, unencUnique: 5, encrypted: 8 },
          { id: 'c', unencrypted: 5, unencUnique: 6, encrypted: 7 },
        );

        await getTyped(col).where('unencrypted', 4).remove();

        const records = await fromAsync(getTyped(backingCol).all().values());
        expect(records.length).toEqual(1);
        expect(records[0]?.id).toEqual('c');
      },
    );

    it('allows getting all values', { timeout: 5000 }, async ({ getTyped }) => {
      const value = await fromAsync(getTyped(col).all().values());
      expect(value[0]?.encrypted).toEqual(9);
    });
  });

  describe('encryptByKey value types', () => {
    it('supports JSON values', { timeout: 5000 }, async ({ getTyped }) => {
      const record = { id: 1, value: { foo: ['a', { bar: 7 }] } };

      const enc = encryptByKey(rootKey);
      const col = enc<typeof record>()(['value'], getTyped(db).getCollection('enc'));

      await col.add(record);

      const value = await col.where('id', 1).get();
      expect(value).toEqual(record);
    });

    it('supports Buffer values', { timeout: 5000 }, async ({ getTyped }) => {
      const record = { id: 1, value: Buffer.from('hello', 'utf8') };

      const enc = encryptByKey(rootKey);
      const col = enc<typeof record>()(['value'], getTyped(db).getCollection('enc'));

      await col.add(record);

      const value = await col.where('id', 1).get();
      expect([...value!.value]).toEqual([...record.value]);
    });

    it('forbids encrypting unique attributes', ({ getTyped }) => {
      const record = { id: 1, value: '' };

      const baseCol = getTyped(db).getCollection<Encrypted<typeof record, 'value'>>('enc', {
        value: { unique: true },
      });
      const enc = encryptByKey(rootKey);
      expect(() => enc<typeof record>()(['value'], baseCol)).throws(
        'Cannot wrap unique index value',
      );
    });
  });

  describe('encryptByRecord', () => {
    const keyCol = withCollection<KeyRecord<string, SerialisedKeyT>>(db);
    const backingCol = withCollection<Encrypted<TestType, 'encrypted'>>(db, {
      keys: { encrypted: {}, unencrypted: {}, unencUnique: { unique: true } },
    });
    const col = beforeEach<Collection<TestType>>(async ({ getTyped, setParameter }) => {
      const enc = encryptByRecord(getTyped(keyCol));
      const col = enc<TestType>()(['encrypted'], getTyped(backingCol));
      setParameter(col);
      await col.add({ id: 'a', unencrypted: 4, unencUnique: 4, encrypted: 9 });
    });

    it('stores and retrieves values transparently', { timeout: 5000 }, async ({ getTyped }) => {
      const value = await getTyped(col).where('id', 'a').get();
      expect(value!.encrypted).toEqual(9);

      const backingValue = await getTyped(backingCol).where('id', 'a').get();
      expect(backingValue!.encrypted).not(toEqual(9));
    });

    it(
      'stores per-entry keys in the provided key table',
      { timeout: 5000 },
      async ({ getTyped }) => {
        await getTyped(col).add({ id: 'b', unencrypted: 5, unencUnique: 5, encrypted: 8 });

        const valueA = await getTyped(keyCol).where('id', 'a').get();
        expect(valueA).toBeTruthy();
        expect(valueA!.key).toBeTruthy();

        const valueB = await getTyped(keyCol).where('id', 'b').get();
        expect(valueB).toBeTruthy();
        expect(valueB!.key).toBeTruthy();

        expect(valueA!.key).not(toEqual(valueB!.key));
      },
    );

    it('does not cache keys by default', { timeout: 5000 }, async ({ getTyped }) => {
      await getTyped(keyCol).where('id', 'a').remove();

      await expect(() => getTyped(col).where('id', 'a').get()).throws(
        hasProperty('message', matches(/No encryption key found in .* for record "a"/)),
      );
    });

    it('caches keys if requested', { timeout: 5000 }, async ({ getTyped }) => {
      const enc = encryptByRecord(getTyped(keyCol), { keyCache: { capacity: 1 } });
      const col = enc<TestType>()(['encrypted'], getTyped(backingCol));

      await col.where('id', 'a').get();
      await getTyped(keyCol).where('id', 'a').remove();

      const value = await col.where('id', 'a').get();
      expect(value!.encrypted).toEqual(9);
    });

    it(
      'stores non-encrypted values without modification',
      { timeout: 5000 },
      async ({ getTyped }) => {
        const value = await getTyped(col).where('id', 'a').get();
        expect(value!.id).toEqual('a');
        expect(value!.unencrypted).toEqual(4);

        const backingValue = await getTyped(backingCol).where('id', 'a').get();
        expect(backingValue!.id).toEqual('a');
        expect(backingValue!.unencrypted).toEqual(4);
      },
    );

    it('prevents filtering by encrypted key', ({ getTyped }) => {
      expect(() => getTyped(col).where('encrypted', 9)).throws('Cannot filter by wrapped value');
    });

    it('prevents reading filtered columns without id', { timeout: 5000 }, async ({ getTyped }) => {
      await expect(() => getTyped(col).where('unencrypted', 4).attrs(['encrypted']).get()).throws(
        'Must provide ID for encryption',
      );
    });

    it(
      'removes backing records and keys when records are removed',
      { timeout: 5000 },
      async ({ getTyped }) => {
        await getTyped(col).add(
          { id: 'b', unencrypted: 4, unencUnique: 5, encrypted: 8 },
          { id: 'c', unencrypted: 5, unencUnique: 6, encrypted: 7 },
        );

        await getTyped(col).where('unencrypted', 4).remove();

        const keys = await fromAsync(getTyped(keyCol).all().values());
        expect(keys.length).toEqual(1);
        expect(keys[0]?.id).toEqual('c');

        const records = await fromAsync(getTyped(backingCol).all().values());
        expect(records.length).toEqual(1);
        expect(records[0]?.id).toEqual('c');
      },
    );

    it('allows getting all values', { timeout: 5000 }, async ({ getTyped }) => {
      const value = await fromAsync(getTyped(col).all().values());
      expect(value[0]?.encrypted).toEqual(9);
    });
  });

  describe('encryptByRecord value types', () => {
    interface CheckT {
      id: string;
      value: unknown;
    }

    const keyCol = withCollection<KeyRecord<string, SerialisedKeyT>>(db);

    it('supports JSON values', { timeout: 5000 }, async ({ getTyped }) => {
      const col = encryptByRecord(getTyped(keyCol))<CheckT>()(
        ['value'],
        getTyped(db).getCollection('enc'),
      );
      const record = { id: 'a', value: { foo: ['a', { bar: 7 }] } };

      await col.add(record);
      const value = await col.where('id', 'a').get();
      expect(value).toEqual(record);
    });

    it('supports Buffer values', { timeout: 5000 }, async ({ getTyped }) => {
      const col = encryptByRecord(getTyped(keyCol))<CheckT>()(
        ['value'],
        getTyped(db).getCollection('enc'),
      );
      const record = { id: 'a', value: Buffer.from('hello', 'utf8') };

      await col.add(record);
      const value = await col.where('id', 'a').get();
      expect([...(value!.value as Buffer)]).toEqual([...record.value]);
    });
  });

  describe('encryptByRecordWithMasterKey', () => {
    const keyCol = withCollection<KeyRecord<string, SerialisedKeyT>>(db);
    const backingCol = withCollection<Encrypted<TestType, 'encrypted'>>(db, {
      keys: { encrypted: {}, unencrypted: {}, unencUnique: { unique: true } },
    });
    const col = beforeEach<Collection<TestType>>(async ({ getTyped, setParameter }) => {
      const enc = encryptByRecordWithMasterKey(rootKey, getTyped(keyCol));
      const col = enc<TestType>()(['encrypted'], getTyped(backingCol));
      setParameter(col);
      await col.add({ id: 'a', unencrypted: 4, unencUnique: 4, encrypted: 9 });
    });

    it('stores and retrieves values transparently', { timeout: 5000 }, async ({ getTyped }) => {
      const value = await getTyped(col).where('id', 'a').get();
      expect(value!.encrypted).toEqual(9);

      const backingValue = await getTyped(backingCol).where('id', 'a').get();
      expect(backingValue!.encrypted).not(toEqual(9));
    });

    it(
      'stores per-entry keys in the provided key table',
      { timeout: 5000 },
      async ({ getTyped }) => {
        await getTyped(col).add({ id: 'b', unencrypted: 5, unencUnique: 5, encrypted: 8 });

        const valueA = await getTyped(keyCol).where('id', 'a').get();
        expect(valueA).toBeTruthy();
        expect(valueA!.key).toBeTruthy();

        const valueB = await getTyped(keyCol).where('id', 'b').get();
        expect(valueB).toBeTruthy();
        expect(valueB!.key).toBeTruthy();

        expect(valueA!.key).not(toEqual(valueB!.key));
      },
    );

    it(
      'does not load keys if no encrypted column is written',
      { timeout: 5000 },
      async ({ getTyped }) => {
        await getTyped(col)
          .where('id', 'b')
          .update({ unencrypted: 5, unencUnique: 5 }, { upsert: true });

        const keyValue = await getTyped(keyCol).where('id', 'b').get();
        expect(keyValue).isFalsy();
      },
    );

    it(
      'does not load keys if no encrypted column is requested',
      { timeout: 5000 },
      async ({ getTyped }) => {
        // copy backing item without copying key
        const item = await getTyped(backingCol).where('id', 'a').get();
        await getTyped(backingCol).add({ ...item!, id: 'b', unencUnique: 5 });

        const value = await getTyped(col).where('id', 'b').attrs(['id', 'unencrypted']).get();
        expect(value!.unencrypted).toEqual(4);

        const keyValue = await getTyped(keyCol).where('id', 'b').get();
        expect(keyValue).isFalsy();
      },
    );

    it(
      'throws if the requested record does not have a key',
      { timeout: 5000 },
      async ({ getTyped }) => {
        // copy backing item without copying key
        const item = await getTyped(backingCol).where('id', 'a').get();
        await getTyped(backingCol).add({ ...item!, id: 'b', unencUnique: 5 });

        await expect(() => getTyped(col).where('id', 'b').attrs(['id', 'encrypted']).get()).throws(
          'No encryption key found',
        );
      },
    );

    it(
      'throws if the requested record has corrupted data',
      { timeout: 5000 },
      async ({ getTyped }) => {
        await getTyped(backingCol)
          .where('id', 'a')
          .update({ encrypted: Buffer.from('nope', 'utf8') });

        await expect(() => getTyped(col).where('id', 'a').get()).throws(
          'Unknown encryption algorithm',
        );
      },
    );

    it(
      'stores non-encrypted values without modification',
      { timeout: 5000 },
      async ({ getTyped }) => {
        const value = await getTyped(col).where('id', 'a').get();
        expect(value!.id).toEqual('a');
        expect(value!.unencrypted).toEqual(4);

        const backingValue = await getTyped(backingCol).where('id', 'a').get();
        expect(backingValue!.id).toEqual('a');
        expect(backingValue!.unencrypted).toEqual(4);
      },
    );

    it('allows updating by id', { timeout: 5000 }, async ({ getTyped }) => {
      await getTyped(col).where('id', 'a').update({ encrypted: 8 });

      const value = await getTyped(col).where('id', 'a').get();
      expect(value!.encrypted).toEqual(8);
    });

    it('allows updating with id', { timeout: 5000 }, async ({ getTyped }) => {
      await getTyped(col).where('unencUnique', 4).update({ id: 'a', encrypted: 8 });

      const value = await getTyped(col).where('id', 'a').get();
      expect(value!.encrypted).toEqual(8);
    });

    it('allows upserting with id', { timeout: 5000 }, async ({ getTyped }) => {
      await getTyped(col)
        .where('id', 'b')
        .update({ encrypted: 8, unencUnique: 5 }, { upsert: true });

      const value = await getTyped(col).where('id', 'b').get();
      expect(value!.encrypted).toEqual(8);
    });

    it('rejects updating without id', { timeout: 5000 }, async ({ getTyped }) => {
      await expect(() => getTyped(col).where('unencrypted', 4).update({ encrypted: 8 })).throws(
        'Must provide ID for encryption',
      );
    });

    it('rejects upserting without id', { timeout: 5000 }, async ({ getTyped }) => {
      await expect(() =>
        getTyped(col)
          .where('unencrypted', 4)
          .update({ encrypted: 8, unencUnique: 5 }, { upsert: true }),
      ).throws('Must provide ID for encryption');
    });

    it('prevents filtering by encrypted key', ({ getTyped }) => {
      expect(() => getTyped(col).where('encrypted', 9)).throws('Cannot filter by wrapped value');
    });

    it('prevents reading filtered columns without id', { timeout: 5000 }, async ({ getTyped }) => {
      await expect(() => getTyped(col).where('unencrypted', 4).attrs(['encrypted']).get()).throws(
        'Must provide ID for encryption',
      );
    });

    it('allows reading filtered columns with id', { timeout: 5000 }, async ({ getTyped }) => {
      const value = await getTyped(col).where('unencrypted', 4).attrs(['id', 'encrypted']).get();
      expect(value!.encrypted).toEqual(9);
    });

    it(
      'allows reading filtered columns if queried by id',
      { timeout: 5000 },
      async ({ getTyped }) => {
        const value = await getTyped(col).where('id', 'a').attrs(['encrypted']).get();
        expect(value!.encrypted).toEqual(9);
      },
    );

    it(
      'prevents reading filtered columns without id (getAll)',
      { timeout: 5000 },
      async ({ getTyped }) => {
        await expect(() =>
          fromAsync(getTyped(col).where('unencrypted', 4).attrs(['encrypted']).values()),
        ).throws('Must provide ID for encryption');
      },
    );

    it(
      'allows reading filtered columns with id (getAll)',
      { timeout: 5000 },
      async ({ getTyped }) => {
        const value = await fromAsync(
          getTyped(col).where('unencrypted', 4).attrs(['id', 'encrypted']).values(),
        );
        expect(value[0]?.encrypted).toEqual(9);
      },
    );

    it(
      'allows reading filtered columns if queried by id (getAll)',
      { timeout: 5000 },
      async ({ getTyped }) => {
        const value = await fromAsync(getTyped(col).where('id', 'a').attrs(['encrypted']).values());
        expect(value[0]?.encrypted).toEqual(9);
      },
    );

    it('allows getting all values', { timeout: 5000 }, async ({ getTyped }) => {
      const value = await fromAsync(getTyped(col).all().values());
      expect(value[0]?.encrypted).toEqual(9);
    });
  });
});

describe('encrypted integration', () => {
  const enc = encryptByKey(randomBytes(32));

  contract({
    factory: () =>
      makeWrappedDB(MemoryDB.connect('memory://'), (base) =>
        enc<IDable & Record<string, unknown>>()(['value'], base),
      ),
  });
});
