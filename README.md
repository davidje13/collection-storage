# Collection Storage

Provides an abstraction layer around communication with a
collection-based database. This makes switching database choices easier
during deployments and testing.

Currently supports MongoDB, Redis (experimental), PostgreSQL, and in-memory
storage.

## Install dependency

```bash
npm install --save git+https://github.com/davidje13/collection-storage.git#semver:^1.8.2
```

If you want to connect to a Mongo database, you will also need to add a
dependency on `mongodb`:

```bash
npm install --save mongodb
```

If you want to connect to a Redis database, you will also need to add a
dependency on `ioredis`:

```bash
npm install --save ioredis
```

**warning**: Redis support is experimental and the database format is likely
to change in later versions.

If you want to connect to a PostgreSQL database, you will also need to add a
dependency on `pg`:

```bash
npm install --save pg
```

**note**: Though PostgreSQL is supported, it is not optimised for this type of
data storage. If possible, use one of the NoSQL options instead.

## Usage

```javascript
import CollectionStorage from 'collection-storage';

const dbUrl = 'memory://something';

async function example() {
  const db = await CollectionStorage.connect(dbUrl);

  const simpleCol = db.getCollection('simple');
  await simpleCol.add({ id: 10, message: 'Hello' });
  const value = await simpleCol.get('id', 10);
  // value is { id: 10, message: 'Hello' }

  const indexedCol = db.getCollection('complex', {
    foo: {},
    bar: { unique: true },
    baz: {},
  });
  await indexedCol.add({ id: 2, foo: 'abc', bar: 'def', baz: 'ghi' });
  await indexedCol.add({ id: 3, foo: 'ABC', bar: 'DEF', baz: 'ghi' });
  const found = await indexedCol.getAll('baz', 'ghi');
  // found is [{ id: 2, ... }, { id: 3, ... }]

  // Next line throws an exception due to the duplicate key in 'bar'
  await indexedCol.add({ id: 4, foo: 'woo', bar: 'def', baz: 'xyz' });

  // Binary data
  const binaryCol = db.getCollection('my-binary-collection');
  await binaryCol.add({ id: 10, someData: Buffer.from('abc', 'utf8') });
  const data = await binaryCol.get('id', 10);
  // data.someData is a Buffer
}
```

## Connection Strings

### In-memory

```
memory://<identifier>[?options]
```

The in-memory database stores data in `Map`s and `Set`s. This data is
not stored to disk, so when the application closes it is gone. If you
specify an identifier, subsequent calls using the same identifier
within the same process will access the same database. If you specify
no identifier, the database will always be created fresh.

#### Options

* `simulatedLatency=<milliseconds>`: enforces a delay of the given
  duration whenever data is read or written. This can be used to
  simulate communication with a remote database to ensure that tests do
  not contain race conditions.

### MongoDB

```
mongodb://[username:password@]host1[:port1][,...hostN[:portN]]][/[database][?options]]
```

See the [mongo documentation](https://docs.mongodb.com/manual/reference/connection-string/)
for full details.

### Redis

```
redis://[username:password@]host[:port][/[database-index][?options]]
rediss://[username:password@]host[:port][/[database-index][?options]]
```

See the [ioredis documentation](https://github.com/luin/ioredis#readme)
for more details.

### PostgreSQL

```
postgresql://[username:password@]host[:port]/database[?options]
```

Options can include `ssl=true`, `sslcert=<cert-file-path>`,
`sslkey=<key-file-path>`, `sslrootcert=<root-file-path>`. For other options,
see the config keys in the
[pg Client constructor documentation](https://node-postgres.com/api/client/#constructor).

## Encryption

You can enable client-side encryption by wrapping the collections:

The encryption used is aes-256-cbc.

Any provided keys (`encryptByKey`) are not stored externally and never leave
the server. These keys must remain constant through restarts and redeploys,
and must be the same on all load-balanced instances. Generated keys
(`encryptByRecord`) are stored in a provided collection (which does not have
to be in the same database, or even in the same database type), and can be
encrypted using a provided key which is not stored.

```javascript
import CollectionStorage, {
  encryptByKey,
  encryptByRecord,
  encryptByRecordWithMasterKey,
} from 'collection-storage';

const dbUrl = 'memory://something';

async function example() {
  const db = await CollectionStorage.connect(dbUrl);

  // input keys must be 32 bytes, e.g.:
  const rootKey = crypto.randomBytes(32);

  // Option 1: single key for all values
  const enc1 = encryptByKey(rootKey);
  const simpleCol1 = enc1(['foo'], db.getCollection('simple1'));

  // Option 2: unique key per value, non-encrypted key
  const keyCol2 = db.getCollection('keys2');
  const enc2 = encryptByRecord(keyCol2, 50); // cache 50 keys
  const simpleCol2 = enc2(['foo'], db.getCollection('simple2'));

  // Option 3 (recommended): unique key per value, encrypted using global key
  const keyCol3 = db.getCollection('keys3');
  const enc3 = encryptByRecordWithMasterKey(rootKey, keyCol3, 50); // cache 50 keys
  const simpleCol3 = enc3(['foo'], db.getCollection('simple3'));

  // option 3 is equivalent to:
  const keyCol4 = encryptByKey(rootKey)(['key'], db.getCollection('keys4'));
  const enc4 = encryptByRecord(keyCol4, 50);
  const simpleCol4 = enc4(['foo'], db.getCollection('simple4'));

  // For all options, the encryption is transparent:
  await simpleCol1.add({ id: 10, foo: 'This is encrypted' });
  const value1 = await simpleCol1.get('id', 10);
  // value1 is { id: 10, foo: 'This is encrypted' }
}
```

Notes:

* You cannot query using encrypted columns
* By default, encryption and decryption is done *synchronously* via the
  built-in `crypto` APIs.

To use another library for cryptography (e.g. to enable asynchronous
operations), you can provide a final parameter to the `encryptBy*` function:

```javascript
const myEncryption = {
  encrypt: async (key, input) => {
    // input (string) => encrypted (Buffer)
  },

  decrypt: async (key, encrypted) => {
    // encrypted (Buffer) => value (string)
  },

  generateKey: () => {
    // return a random key
    // this will be passed to the encrypt/decrypt functions as `key`
  },

  serialiseKey: (key) => {
    // return a string representation of key
  },

  deserialiseKey: (data) => {
    // reverse of serialiseKey
  },
};

const enc = encryptByKey(rootKey, myEncryption);
```

## API

### CollectionStorage

#### `connect`

```javascript
const db = await CollectionStorage.connect(url);
```

Connects to the given database and returns a database wrapper.

### Database

#### `getCollection`

```javascript
const collection = db.getCollection(name, [keys]);
```

Initialises the requested collection in the database and returns a
collection wrapper.

`keys` is an optional object defining the searchable keys for the
collection. For example:

```javascript
const collection = await db.getCollection(name, {
  someSimpleKey: {},
  someUniqueKey: { unique: true },
  anotherSimpleKey: {},
});
```

The `id` attribute is always indexed and should not be specified
explicitly.

#### `close`

```javascript
await db.close();
```

Disconnects from the database. Any in-progress operations will
complete, but any new operations will fail with an exception.

The database object cannot be reused after calling `close`.

The returned promise will resolve once all in-progress operations
have completed and all connections have fully closed.

### Collection

#### `add`

```javascript
await collection.add(value);
```

Adds the given value to the collection. `value` should be an object
with an `id` and any other fields you wish to save.

#### `update`

```javascript
await collection.update(searchAttr, searchValue, update, [options]);
```

Updates all entries which match `searchAttr = searchValue`. Any
attributes not specified in `update` will remain unchanged.

The `searchAttr` can be any indexed attribute (including `id`).

When using a non-unique index, only non-unique values can be
specified, even if the data contains only one matching entry.

If `options` is `{ upsert: true }` and no values match the search, a
new entry will be added. If using `upsert` mode, the `searchAttr`
must be `id`.

#### `get`

```javascript
const value = await collection.get(searchAttr, searchValue, [attrs]);
```

Returns one entry which matches `searchAttr = searchValue`. If `attrs`
is specified, only the attributes listed will be returned (by default,
all attributes are returned).

The `searchAttr` can be any indexed attribute (including `id`).

`attrs` is an optional list of strings denoting the attributes to
return.

If no values match, returns `null`.

#### `getAll`

```javascript
const values = await collection.getAll(searchAttr, searchValue, [attrs]);
```

Like `get`, but returns a list of all matching values. If no values
match, returns an empty list.

#### `remove`

```javascript
const count = await collection.remove(searchAttr, searchValue);
```

Removes all entries matching `searchAttr = searchValue`.

The `searchAttr` can be any indexed attribute (including `id`).

Returns the number of records removed (0 if no records matched).

### Encrypted

#### `encryptByKey`

```javascript
const enc = encryptByKey(key, [customEncryption]);
const collection = enc(['encryptedField', 'another'], baseCollection);
```

Returns a function which can wrap collections with encryption.

By default the provided `key` should be a 32-byte buffer.
If custom encryption is used, the key should conform to its expectations.

See example notes above for an example on using `customEncryption`.

#### `encryptByRecord`

```javascript
const enc = encryptByRecord(keyCollection, [cacheSize], [customEncryption]);
const collection = enc(['myEncryptedField', 'another'], baseCollection);
```

Returns a function which can wrap collections with encryption.

Stores one key per ID in `keyCollection` (unencrypted). If `cacheSize` is
provided, uses a least-recently-used cache for keys to reduce database access.

Updating a record re-encrypts using the same key. Removing records also
removes the corresponding keys.

See example notes above for an example on using `customEncryption`.

#### `encryptByRecordWithMasterKey`

```javascript
const enc = encryptByRecordWithMasterKey(masterKey, keyCollection, [cacheSize], [customEncryption]);
const collection = enc(['myEncryptedField', 'another'], baseCollection);
```

Returns a function which can wrap collections with encryption.

Stores one key per ID in `keyCollection` (encrypted using `masterKey`).
If `cacheSize` is provided, uses a least-recently-used cache for keys to
reduce database access.

This is equivalent to:

```javascript
const keys = encryptByKey(masterKey, [customEncryption])(keyCollection, ['key']);
const enc = encryptByRecord(keys, [cacheSize], [customEncryption]);
const collection = enc(['myEncryptedField', 'another'], baseCollection);
```

See example notes above for an example on using `customEncryption`.

## Development

To run the test suite, you will need to have a local installation of MongoDB,
Redis and PostgreSQL. By default, the tests will connect to
`mongodb://localhost:27017/collection-storage-tests`,
`redis://localhost:6379/15`, and
`postgresql://localhost:5432/collection-storage-tests`. You can change this if
required by setting the `MONGO_URL`, `REDIS_URL`, and `PSQL_URL` environment
variables.

**warning**: By default, this will flush any Redis database at index 15. If
you have used database 15 for your own data, you should set `REDIS_URL` to
use a different database index.

**note**: The PostgreSQL tests will connect to the given server's `postgres`
database to drop (if necessary) and re-create the specified test database.
You do not need to create the test database yourself.

On macOS: MongoDB, Redis and PostgreSQL can be installed with:

```bash
brew install mongodb redis postgresql
brew services start mongodb
brew services start redis
brew services start postgresql
```

On Ubuntu: they can be installed with:

```bash
apt install mongodb redis-server postgresql-11
```

Or portably using Docker:

```bash
docker run -d mongo:4
docker run -d redis:5-alpine
docker run -d postgres:11-alpine
```
