import migrate from './migrated';
import CollectionStorage from '../CollectionStorage';
import type { Collection } from '../interfaces/Collection';

interface TestType {
  id: string;
  field1?: number;
  field2?: string;
  field3?: string;
}

describe('migrate', () => {
  let backingCol: Collection<TestType>;

  beforeEach(async () => {
    const db = await CollectionStorage.connect('memory://');
    backingCol = db.getCollection('migrate');
  });

  it('delegates add requests to the backing collection', async () => {
    const col = migrate({
      field1: (v) => (v ?? 1),
    }, backingCol);

    await col.add({ id: 'foo' });

    const value = await backingCol.get('id', 'foo');
    expect(value).not.toBeNull();
  });

  it('applies the migration when fetching values via get', async () => {
    const col = migrate({
      field1: (v) => (v ?? 1),
    }, backingCol);

    await backingCol.add({ id: 'old' });
    await backingCol.add({ id: 'new', field1: 7 });

    const valueOld = await col.get('id', 'old');
    expect(valueOld!.field1).toEqual(1);

    const valueNew = await col.get('id', 'new');
    expect(valueNew!.field1).toEqual(7);
  });

  it('applies the migration when fetching values via getAll', async () => {
    const col = migrate({
      field1: (v) => (v ?? 1),
    }, backingCol);

    await backingCol.add({ id: 'old' });
    await backingCol.add({ id: 'new', field1: 7 });

    const values = await col.getAll();
    values.sort((a, b) => ((a.id < b.id) ? 1 : -1));
    expect(values[0].field1).toEqual(1);
    expect(values[1].field1).toEqual(7);
  });

  it('only applies relevant migrations', async () => {
    let count1 = 0;
    let count2 = 0;
    const col = migrate({
      field1: () => {
        count1 += 1;
        return 0;
      },
      field2: () => {
        count2 += 1;
        return '';
      },
    }, backingCol);

    await backingCol.add({ id: 'old' });

    await col.get('id', 'old', ['field1']);
    expect(count1).toEqual(1);
    expect(count2).toEqual(0);

    count1 = 0;
    count2 = 0;
    await col.get('id', 'old', ['field1', 'field2']);
    expect(count1).toEqual(1);
    expect(count2).toEqual(1);

    count1 = 0;
    count2 = 0;
    await col.get('id', 'old', ['id']);
    expect(count1).toEqual(0);
    expect(count2).toEqual(0);

    count1 = 0;
    count2 = 0;
    await col.get('id', 'old');
    expect(count1).toEqual(1);
    expect(count2).toEqual(1);
  });

  it('fetches extra fields if requested', async () => {
    let capturedRecord = null;
    const col = migrate(['field2'], {
      field1: (v, record) => {
        capturedRecord = record;
        return 0;
      },
    }, backingCol);

    await backingCol.add({ id: 'old', field2: 'foo', field3: 'irrelevant' });

    await col.get('id', 'old', ['field1']);
    expect(capturedRecord).toEqual({ field1: undefined, field2: 'foo' });
  });
});
