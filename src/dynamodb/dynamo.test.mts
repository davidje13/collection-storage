import { randomBytes } from 'node:crypto';
import { cache, compress, encryptByKey, type IDable } from '../core/index.mts';
import { contract, fromAsync, migrationContract } from '../test-helpers/db.contract-test.mts';
import { makeWrappedDB } from '../test-helpers/makeWrappedDB.mts';
import { DynamoDB } from './DynamoDB.mts';

const url = new URL(
  process.env['DDB_URL'] ||
    'dynamodb://key:secret@localhost:8000/collection-storage-tests-?tls=false&consistentRead=true',
);
if (url.pathname.length <= 1) {
  // test tables MUST have a prefix, or it will not be possible to clear them after testing
  url.pathname = '/collection-storage-tests-';
}
const prefix = url.pathname.substring(1);

async function deleteTestTables(): Promise<void> {
  const db = DynamoDB.connect(url.href);
  const ddb = db.getDDB();
  const allTables = await ddb.getTableNames().all();
  await Promise.all(
    allTables.filter((name) => name.startsWith(prefix)).map((name) => ddb.deleteTable(name)),
  );
  await db.close();
}

const KNOWN_CONSUMPTION: Record<string, number> = {
  'stores and retrieves data': 2,

  'add > rejects duplicate IDs': 2,
  'add > rejects duplicates in unique indices': 4,

  'get > returns only the requested attributes': 1,
  'get > returns the special ID attribute if requested': 1,
  'get > returns all attributes by default': 1,
  'get > allows filters using any indexed attribute': 1.5,
  'get > returns null if no values match': 0,
  'get > returns any value if no filter is specified': 1,

  'get unique > returns only the requested attributes': 2,
  'get unique > uses just the index if possible': 1,
  'get unique > returns all attributes by default': 2,

  'values > returns only the requested attributes': 1,
  'values > returns all attributes by default': 1,
  'values > allows filters using any indexed attribute': 2.5,
  'values > returns an empty list if no values match': 0,
  'values > returns all values if no filter is specified': 1,

  'update > changes only matching entries': 4,
  'update > rejects and rolls-back changes which cause duplicates': 2,
  'update > allows setting unique columns to the same value': 3,
  'update > allows setting unique columns to historic values': 9,
  'update > changes all matching entries': 4.5,
  'update > rejects conflicts from changing multiple records': 2,
  'update > does nothing if no value matches': 4,

  'update > upsert > updates existing records if found by ID': 3,
  'update > upsert > adds a new record if no value matches using key ID': 5,
  'update > upsert > rejects duplicates if no value matches': 2,

  'remove > removes items from the collection': 3,
  'remove > removes all items matching the query': 5.5,
  'remove > returns 0 if no values match for ID': 1,
};

const KNOWN_MIGRATION_CONSUMPTION: Record<string, number> = {
  'data migration > adds indices': 11.5,
  'data migration > adds indices with existing data': 12.5,
  'data migration > adds unique indices with existing data': 13,
  'data migration > adds uniqueness to existing indices': 13,
  'data migration > removes uniqueness from existing indices': 5.5,
  'data migration > removes indices': 0,
  'data migration > removes unique indices': 2,
};

describe('DynamoDB contract', () => {
  const checkedConsumptions = new Set<string>();

  beforeAll(deleteTestTables);
  afterAll(deleteTestTables); // clean up after as well as before

  const testId = beforeEach<string>(({ testPath, setParameter }) => {
    setParameter(testPath.slice(2).join(' > '));
  });

  const { db } = contract({
    factory: () => DynamoDB.connect(url.href),
    testWrapper: ({ getTyped }) => {
      const ddb = getTyped(db).getDDB();
      const before = ddb.getConsumedUnits();

      const fullname = getTyped(testId);
      checkedConsumptions.add(fullname);
      const expectedUnits = KNOWN_CONSUMPTION[fullname];
      if (expectedUnits === undefined) {
        return;
      }

      return () => {
        expect(ddb.getConsumedUnits() - before).toEqual(expectedUnits);
      };
    },
  });

  afterAll(() => {
    const untested = new Set(Object.keys(KNOWN_CONSUMPTION));
    checkedConsumptions.forEach((key) => untested.delete(key));
    if (untested.size) {
      const items = [...untested].join('\n');
      console.error(`KNOWN_CONSUMPTION contained untested keys:\n${items}`);
    }
  });
});

describe('DynamoDB migration contract', () => {
  const checkedConsumptions = new Set<string>();

  beforeAll(deleteTestTables);
  afterAll(deleteTestTables); // clean up after as well as before

  const testId = beforeEach<string>(({ testPath, setParameter }) => {
    setParameter(testPath.slice(2).join(' > '));
  });

  const { dbAfter } = migrationContract({
    factory: () => () => DynamoDB.connect(url.href),
    testWrapper: ({ getTyped }) => {
      const ddb = getTyped(dbAfter).getDDB();
      const before = ddb.getConsumedUnits();

      const fullname = getTyped(testId);
      checkedConsumptions.add(fullname);
      const expectedUnits = KNOWN_MIGRATION_CONSUMPTION[fullname];
      if (expectedUnits === undefined) {
        return;
      }

      return () => {
        expect(ddb.getConsumedUnits() - before).toEqual(expectedUnits);
      };
    },
  });

  afterAll(() => {
    const untested = new Set(Object.keys(KNOWN_MIGRATION_CONSUMPTION));
    checkedConsumptions.forEach((key) => untested.delete(key));
    if (untested.size) {
      const items = [...untested].join('\n');
      console.error(`KNOWN_MIGRATION_CONSUMPTION contained untested keys:\n${items}`);
    }
  });
});

describe('DynamoDB scaling', () => {
  it('can share tables between connections', { timeout: 5000 }, async () => {
    const db1 = DynamoDB.connect(url.href);
    const db2 = DynamoDB.connect(url.href);

    try {
      const col1 = db1.getCollection('shared');
      const col2 = db2.getCollection('shared');

      const stored = { id: '1', value: 'shared-value' };
      await col1.add(stored);

      const retrieved = await col2.where('id', stored.id).get();
      expect(retrieved).toEqual(stored);
    } finally {
      await db1.close();
      await db2.close();
    }
  });
});

describe('DynamoDB provisioning', () => {
  it(
    'uses the given throughput function to determine provisioned throughput',
    { timeout: 5000 },
    async () => {
      const throughputFn = mock();
      const db = DynamoDB.connect(url.href, throughputFn);

      try {
        const col = db.getCollection<any>('with-throughput-fn', {
          nonunique1: {},
          nonunique2: {},
          unique1: { unique: true },
          unique2: { unique: true },
        });
        await fromAsync(col.all().values());
      } finally {
        await db.close();
      }

      expect(throughputFn).toHaveBeenCalledWith('with-throughput-fn', null);
      expect(throughputFn).toHaveBeenCalledWith('with-throughput-fn', 'nonunique1');
      expect(throughputFn).toHaveBeenCalledWith('with-throughput-fn', 'nonunique2');
      expect(throughputFn).toHaveBeenCalledWith('with-throughput-fn', 'unique1');
      expect(throughputFn).toHaveBeenCalledWith('with-throughput-fn', 'unique2');
    },
  );

  it(
    'applies fixed provisioning if configured in the query string',
    { timeout: 5000 },
    async () => {
      const db = DynamoDB.connect(`${url.href}&provision_provisioned=3.2`);

      try {
        const col = db.getCollection('provisioned');
        await fromAsync(col.all().values());
        const description = await db.getDDB().describeTable(col.internalTableName);
        expect(description.Table.ProvisionedThroughput.ReadCapacityUnits).toEqual(3);
        expect(description.Table.ProvisionedThroughput.WriteCapacityUnits).toEqual(2);
      } finally {
        await db.close();
      }
    },
  );

  it('rejects invalid provision formats', { timeout: 5000 }, async () => {
    const db = DynamoDB.connect(`${url.href}&provision_bad-provisioned=1-1`);

    try {
      const col = db.getCollection('bad-provisioned');
      await expect(() => col.all().count()).throws();
    } finally {
      await db.close();
    }
  });
});

describe('DynamoDB cached', () => {
  contract({
    factory: () =>
      makeWrappedDB(DynamoDB.connect(url.href), (base) =>
        cache(base, { capacity: 10, maxAge: 5000 }),
      ),
  });
});

describe('DynamoDB compressed', () => {
  contract({
    factory: () => makeWrappedDB(DynamoDB.connect(url.href), (base) => compress(['value'], base)),
  });
});

describe('DynamoDB encrypted', () => {
  const enc = encryptByKey(randomBytes(32));

  contract({
    factory: async () =>
      makeWrappedDB(DynamoDB.connect(url.href), (base) =>
        enc<IDable & Record<string, unknown>>()(['value'], base),
      ),
  });
});
