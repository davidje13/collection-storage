import { CollectionStorage, DB, MemoryDB } from 'collection-storage';
import { DynamoDB } from '@collection-storage/dynamodb';
import { MongoDB } from '@collection-storage/mongodb';
import { PostgresDB } from '@collection-storage/postgresql';
import { RedisDB } from '@collection-storage/redis';
import { SQLiteDB } from '@collection-storage/sqlite';

async function test() {
  const dbGen: DB = await CollectionStorage.connect('foo');
  const dbMem: DB = MemoryDB.connect('foo');
  const dbDDB: DB = DynamoDB.connect('foo');
  const dbMon: DB = await MongoDB.connect('foo');
  const dbPgs: DB = await PostgresDB.connect('foo');
  const dbRed: DB = RedisDB.connect('foo');
  const dbSql: DB = SQLiteDB.connect('foo');
  await dbMem.close();
  await dbDDB.close();
  await dbMon.close();
  await dbPgs.close();
  await dbRed.close();
  await dbSql.close();

  const col1 = dbGen.getCollection('c1');
  await col1.add({ id: 'one' });
  await col1.add({ id: 'one' }, { id: 'two' });

  // @ts-expect-error
  await col1.add({ nonid: 'one' });

  const col2 = dbGen.getCollection<{ id: number; foo: string; bar: number }>(
    'c2',
    { foo: {}, bar: { unique: true } },
  );

  await col2.add({ id: 1, foo: 'hello', bar: 1 });

  // @ts-expect-error
  await col2.add({ id: 'one' });

  // @ts-expect-error
  await col2.add({ id: 'one', foo: 'hello', bar: 1 });

  assertType(await col2.all().get())<Readonly<{
    id: number;
    foo: string;
    bar: number;
  }> | null>();

  for await (const record of col2.all().values()) {
    assertType(record)<Readonly<{ id: number; foo: string; bar: number }>>();
  }

  assertType(await col2.all().count())<number>();

  assertType(await col2.all().exists())<boolean>();

  assertType(await col2.all().attrs(['id', 'bar']).get())<Readonly<{
    id: number;
    bar: number;
  }> | null>();

  for await (const record of col2.all().attrs(['id', 'bar']).values()) {
    assertType(record)<Readonly<{ id: number; bar: number }>>();
  }

  assertType(await col2.all().get())<Readonly<{
    id: number;
    foo: string;
    bar: number;
  }> | null>();

  for await (const record of col2.where('foo', 'this').values()) {
    assertType(record)<Readonly<{ id: number; foo: string; bar: number }>>();
  }

  assertType(await col2.where('foo', 'this').count())<number>();

  assertType(await col2.where('foo', 'this').exists())<boolean>();

  await col2.where('foo', 'this').update({ bar: 2 });

  await col2.where('id', 3).update({ bar: 2 }, { upsert: true });

  assertType(
    await col2.where('foo', 'this').attrs(['id', 'bar']).get(),
  )<Readonly<{ id: number; bar: number }> | null>();

  for await (const record of col2
    .where('foo', 'this')
    .attrs(['id', 'bar'])
    .values()) {
    assertType(record)<Readonly<{ id: number; bar: number }>>();
  }
}

// assertion helper
type Equals<A, B> =
  (<G>() => G extends A ? 1 : 2) extends <G>() => G extends B ? 1 : 2
    ? []
    : ['nope'];
const assertType =
  <Actual>(_: Actual) =>
  <Expected>(..._typesDoNotMatch: Equals<Actual, Expected>) => {};
