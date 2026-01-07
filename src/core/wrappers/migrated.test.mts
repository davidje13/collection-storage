import { fromAsync, withCollection, withDB } from '../../test-helpers/db.contract-test.mts';
import { MemoryDB } from '../memory/MemoryDB.mts';
import { migrate } from './migrated.mts';
import 'lean-test';

interface TestType {
  id: string;
  field1?: number;
  field2?: string;
  field3?: string;
}

describe('migrate', () => {
  const db = withDB(() => MemoryDB.connect('memory://'));
  const backingCol = withCollection<TestType>(db, {}, []);

  it(
    'delegates add requests to the backing collection',
    { timeout: 5000 },
    async ({ getTyped }) => {
      const col = migrate({ field1: (v) => v ?? 1 }, getTyped(backingCol));

      await col.add({ id: 'foo' });

      const value = await getTyped(backingCol).where('id', 'foo').get();
      expect(value).not(toBeNull());
    },
  );

  it('applies the migration when fetching via get', { timeout: 5000 }, async ({ getTyped }) => {
    const col = migrate({ field1: (v) => v ?? 1 }, getTyped(backingCol));

    await getTyped(backingCol).add({ id: 'old' }, { id: 'new', field1: 7 });

    const valueOld = await col.where('id', 'old').get();
    expect(valueOld!.field1).toEqual(1);

    const valueNew = await col.where('id', 'new').get();
    expect(valueNew!.field1).toEqual(7);
  });

  it('applies the migration when fetching via values', { timeout: 5000 }, async ({ getTyped }) => {
    const col = migrate({ field1: (v) => v ?? 1 }, getTyped(backingCol));

    await getTyped(backingCol).add({ id: 'old' }, { id: 'new', field1: 7 });

    const values = await fromAsync(col.all().values());
    values.sort((a, b) => (a.id < b.id ? 1 : -1));
    expect(values[0]?.field1).toEqual(1);
    expect(values[1]?.field1).toEqual(7);
  });

  it('only applies relevant migrations', { timeout: 5000 }, async ({ getTyped }) => {
    let count1 = 0;
    let count2 = 0;
    const col = migrate(
      {
        field1: () => {
          ++count1;
          return 0;
        },
        field2: () => {
          ++count2;
          return '';
        },
      },
      getTyped(backingCol),
    );

    await getTyped(backingCol).add({ id: 'old' });

    await col.where('id', 'old').attrs(['field1']).get();
    expect(count1).toEqual(1);
    expect(count2).toEqual(0);

    count1 = 0;
    count2 = 0;
    await col.where('id', 'old').attrs(['field1', 'field2']).get();
    expect(count1).toEqual(1);
    expect(count2).toEqual(1);

    count1 = 0;
    count2 = 0;
    await col.where('id', 'old').attrs(['id']).get();
    expect(count1).toEqual(0);
    expect(count2).toEqual(0);

    count1 = 0;
    count2 = 0;
    await col.where('id', 'old').get();
    expect(count1).toEqual(1);
    expect(count2).toEqual(1);
  });

  it('fetches extra attributes if requested for get', { timeout: 5000 }, async ({ getTyped }) => {
    let capturedRecord = null;
    const col = migrate(
      ['field2'],
      {
        field1: (_, record) => {
          capturedRecord = record;
          return 1;
        },
      },
      getTyped(backingCol),
    );

    await getTyped(backingCol).add({ id: 'old', field1: 0, field2: 'foo', field3: 'irrelevant' });

    const returned = await col.where('id', 'old').attrs(['field1']).get();
    expect(capturedRecord).toEqual({ field1: 0, field2: 'foo' });
    expect(returned).toEqual({ field1: 1 });
  });

  it(
    'fetches extra attributes if requested for values',
    { timeout: 5000 },
    async ({ getTyped }) => {
      const capturedRecords: Partial<TestType>[] = [];
      const col = migrate(
        ['field2'],
        {
          field1: (_, record) => {
            capturedRecords.push(record);
            return 1;
          },
        },
        getTyped(backingCol),
      );

      await getTyped(backingCol).add({ id: 'old', field1: 0, field2: 'foo', field3: 'irrelevant' });

      const returned = await fromAsync(col.where('id', 'old').attrs(['field1']).values());
      expect(capturedRecords).toEqual([{ field1: 0, field2: 'foo' }]);
      expect(returned).toEqual([{ field1: 1 }]);
    },
  );
});
