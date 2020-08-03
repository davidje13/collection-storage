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

describe('DynamoDb', () => {
  contract({
    beforeAll: deleteTestTables,
    afterAll: deleteTestTables, // clean up after as well as before
    // afterEach: (db) => console.info(`total usage: ${db.getDDB().getConsumedUnits()}`),
    factory: (): DynamoDb => DynamoDb.connect(url.href),
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
