# Collection Storage

Provides an abstraction layer around communication with a collection-based
database. This makes switching database choices easier during deployments and
testing. Includes wrappers for encryption, compression, caching, and per-record
migration.

Currently supports:

- in-memory storage (available by default)
- [DynamoDB](https://www.npmjs.com/package/@collection-storage/dynamodb)
- [MongoDB](https://www.npmjs.com/package/@collection-storage/mongodb)
- [PostgreSQL](https://www.npmjs.com/package/@collection-storage/postgresql)
  **note**: Though PostgreSQL is supported, it is not optimised for this type of
  data storage. If possible, use one of the NoSQL options instead.
- [Redis](https://www.npmjs.com/package/@collection-storage/redis) **warning**:
  Redis support is experimental and the database format is likely to change in
  later versions.
- [SQLite](https://www.npmjs.com/package/@collection-storage/sqlite) (Node.js
  22.13+) **note**: Though SQLite is supported, it is not optimised for this
  type of data storage and does not support multiple processes sharing a single
  database. If possible, use one of the NoSQL options instead.

## Install dependency

```sh
npm install --save collection-storage
```

In-memory storage is available by default. To use anything else, you will need
to add the corresponding dependency:

```sh
npm install --save @collection-storage/dynamodb
npm install --save @collection-storage/mongodb
npm install --save @collection-storage/postgresql
npm install --save @collection-storage/redis
npm install --save @collection-storage/sqlite
```

And register them either synchronously or asynchronously:

```js
import { CollectionStorage } from 'collection-storage';

CollectionStorage.dynamic([
  ['dynamodb', () => import('@collection-storage/dynamodb')],
  ['mongodb', () => import('@collection-storage/mongodb')],
  ['mongodb+srv', () => import('@collection-storage/mongodb')],
  ['postgresql', () => import('@collection-storage/postgresql')],
  ['redis', () => import('@collection-storage/redis')],
  ['rediss', () => import('@collection-storage/redis')],
  ['sqlite', () => import('@collection-storage/sqlite')],
]);
```

## Usage

```js
import { CollectionStorage } from 'collection-storage';

const db = await CollectionStorage.connect('memory://something');

const simpleCol = db.getCollection('simple');
await simpleCol.add({ id: 10, message: 'Hello' });
const record = await simpleCol.where('id', 10).get();
// record is { id: 10, message: 'Hello' }

const indexedCol = db.getCollection('complex', {
  foo: {},
  bar: { unique: true },
  baz: {},
});
await indexedCol.add(
  { id: 2, foo: 'abc', bar: 'def', baz: 'ghi' },
  { id: 3, foo: 'ABC', bar: 'DEF', baz: 'ghi' },
);

// .values() returns an async generator. This can be passed to (e.g.) Array.fromAsync to collect all values into a list.
const found = await Array.fromAsync(indexedCol.where('baz', 'ghi').values());
// found is [{ id: 2, ... }, { id: 3, ... }]

// Next line throws an exception due to the duplicate key in 'bar'
await indexedCol.add({ id: 4, foo: 'woo', bar: 'def', baz: 'xyz' });

// Binary data
const binaryCol = db.getCollection('my-binary-collection');
await binaryCol.add({ id: 10, someData: Buffer.from('abc', 'utf8') });
const data = await binaryCol.where('id', 10).get();
// data.someData is a Buffer
```

The unindexed properties of your records do not need to be consistent. In
particular, this means that later versions of your application are free to
change the unindexed attributes, and both versions can co-exist (see
[migrate](#migrated) below for details on enabling automatic migrations on a
per-record basis).

The MongoDB, PostgreSQL, and SQLite databases support changing indices in any
way at a later point. In a later deploy, you can simply create your collection
with different indices, and the necessary changes will happen automatically.
DynamoDB indices will also be updated automatically but note that this may take
some time and will use up capacity on the indices. Redis does not currently
support changing or removing existing indices, and will not index existing data
if a new index is added.

## Connection Strings

See the readme for the database connector you are using for its connection
strings. By default, only the in-memory connector is available:

### In-memory

```
memory://<identifier>[?options]
```

The in-memory database stores data in `Map`s and `Set`s. This data is not stored
to disk, so when the application closes it is gone. If you specify an
identifier, subsequent calls using the same identifier within the same process
will access the same database. If you specify no identifier, the database will
always be created fresh.

#### Options

- `simulatedLatency=<milliseconds>`: enforces a delay of the given duration
  whenever data is read or written. This can be used to simulate communication
  with a remote database to ensure that tests do not contain race conditions.

## Documentation

[The full documentation can be found here](/docs/API.md).
