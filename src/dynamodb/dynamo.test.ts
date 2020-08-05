import DynamoDb from './DynamoDb';
import contract from '../db.contract-test';

const url = new URL(process.env.PSQL_URL || 'dynamodb://key:secret@localhost:8000/collection-storage-tests-?tls=false&consistentRead=true');
if (url.pathname.length <= 1) {
  // test tables MUST have a prefix, or it will not be possible to clear them after testing
  url.pathname = '/collection-storage-tests-';
}
const prefix = url.pathname.substr(1);

async function deleteTestTables(): Promise<void> {
  const db = DynamoDb.connect(url.href);
  const ddb = db.getDDB();
  const allTables = await ddb.getTableNames().all();
  await Promise.all(allTables
    .filter((name) => name.startsWith(prefix))
    .map((name) => ddb.deleteTable(name)));
  await db.close();
}

const KNOWN_CONSUMPTION: Record<string, number> = {
  'stores and retrieves data': 2,

  'add > rejects duplicate IDs': 2,
  'add > rejects duplicates in unique indices': 16,

  'get > returns only the requested attributes': 1,
  'get > returns the special ID attribute if requested': 1,
  'get > returns all attributes by default': 1,
  'get > allows filters using any indexed attribute': 1.5,
  'get > returns null if no values match': 0,

  'getAll > returns only the requested attributes': 1,
  'getAll > returns all attributes by default': 1,
  'getAll > allows filters using any indexed attribute': 2.5,
  'getAll > returns an empty list if no values match': 0,
  'getAll > returns all values if no filter is specified': 1,

  'update > changes only matching entries': 4,
  'update > rejects and rolls-back changes which cause duplicates': 2,
  'update > allows setting unique columns to the same value': 3,
  'update > allows setting unique columns to historic values': 21,
  'update > changes all matching entries': 4.5,
  'update > rejects conflicts from changing multiple records': 2,
  'update > does nothing if no value matches': 4,

  'update > upsert > updates existing records if found by ID': 3,
  'update > upsert > adds a new record if no value matches using key ID': 14,
  'update > upsert > rejects duplicates if no value matches': 2,

  'remove > removes items from the collection': 3,
  'remove > removes all items matching the query': 5.5,
  'remove > returns 0 if no values match for ID': 1,

  'data migration > adds indices': 23.5,
  'data migration > adds indices with existing data': 24.5,
  'data migration > adds unique indices with existing data': 11,
  'data migration > adds uniqueness to existing indices': 11,
  'data migration > removes uniqueness from existing indices': 5.5,
  'data migration > removes indices': 0,
  'data migration > removes unique indices': 2,
};

describe('DynamoDb', () => {
  const checkedConsumptions = new Set<string>();

  contract({
    beforeAll: deleteTestTables,
    afterAll: deleteTestTables, // clean up after as well as before
    testWrapper: async (name, fn, getDB) => {
      const ddb = getDB().getDDB();
      const before = ddb.getConsumedUnits();
      await fn();
      const after = ddb.getConsumedUnits();

      const fullname = name.join(' > ');
      const consumedUnits = after - before;
      const expectedUnits = KNOWN_CONSUMPTION[fullname];
      if (expectedUnits !== undefined) {
        checkedConsumptions.add(fullname);
        expect(consumedUnits).toEqual(expectedUnits);
      }
    },
    factory: (): DynamoDb => DynamoDb.connect(url.href),
  });

  afterAll(() => {
    const untested = new Set(Object.keys(KNOWN_CONSUMPTION));
    checkedConsumptions.forEach((key) => untested.delete(key));
    if (untested.size) {
      const items = [...untested].join('\n');
      /* eslint-disable-next-line no-console */ // necessary for afterAll output
      console.error(`KNOWN_CONSUMPTION contained untested keys:\n${items}`);
    }
  });

  it('can share tables between connections', async () => {
    const db1 = DynamoDb.connect(url.href);
    const db2 = DynamoDb.connect(url.href);

    try {
      const col1 = db1.getCollection(`${prefix}shared`);
      const col2 = db2.getCollection(`${prefix}shared`);

      const stored = { id: '1', value: 'shared-value' };
      await col1.add(stored);

      const retrieved = await col2.get('id', stored.id);
      expect(retrieved).toEqual(stored);
    } finally {
      await db1.close();
      await db2.close();
    }
  });
});
