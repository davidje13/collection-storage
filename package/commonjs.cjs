const { CollectionStorage } = require('collection-storage');

CollectionStorage.dynamic([
  ['dynamodb', () => require('@collection-storage/dynamodb')],
  ['mongodb', () => require('@collection-storage/mongodb')],
  ['mongodb+srv', () => require('@collection-storage/mongodb')],
  ['postgresql', () => require('@collection-storage/postgresql')],
  ['redis', () => require('@collection-storage/redis')],
  ['rediss', () => require('@collection-storage/redis')],
  ['sqlite', () => require('@collection-storage/sqlite')],
]);

async function basicTest(dbURL, expectedClass) {
  const db = await CollectionStorage.connect(dbURL);
  try {
    if (db.constructor.name !== expectedClass) {
      throw new Error(
        `${expectedClass}: Unexpected database type: ${db.constructor.name}`,
      );
    }
    const col = db.getCollection('package-test');
    const id = `test-${Date.now()}-${Math.random()}`;
    await col.add({ id, value: 'my-value' });
    const retrieved = await col.where('id', id).get();
    if (retrieved?.id !== id || retrieved?.value !== 'my-value') {
      throw new Error(`${expectedClass}: Retrieved values does not match`);
    }
    await col.removeAllAndDestroy();
  } finally {
    await db.close();
  }
}

async function test() {
  await basicTest('memory://', 'MemoryDB');
  await basicTest(
    process.env['DDB_URL'] ||
      'dynamodb://key:secret@localhost:8000/collection-storage-tests-?tls=false&consistentRead=true',
    'DynamoDB',
  );
  await basicTest(
    process.env['MONGO_URL'] ||
      'mongodb://localhost:27017/collection-storage-tests',
    'MongoDB',
  );
  await basicTest(
    process.env['PSQL_URL'] ||
      'postgresql://postgres:password@localhost:5432/collection-storage-tests',
    'PostgresDB',
  );
  await basicTest(
    process.env['REDIS_URL'] || 'redis://localhost:6379/15',
    'RedisDB',
  );
  if (Number(process.version.substring(1).split('.')[0]) >= 22) {
    await basicTest('sqlite://', 'SQLiteDB');
  }
}

test();
