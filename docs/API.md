# Collection Storage API

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

## Encryption

You can enable client-side encryption by wrapping the collections:

The encryption used is aes-256-cbc.

Any provided keys (`encryptByKey`) are not stored externally and never leave the
server. These keys must remain constant through restarts and redeploys, and must
be the same on all load-balanced instances. Generated keys (`encryptByRecord`)
are stored in a provided collection (which does not have to be in the same
database, or even in the same database type), and can be encrypted using a
provided key which is not stored.

```js
import {
  CollectionStorage,
  encryptByKey,
  encryptByRecord,
  encryptByRecordWithMasterKey,
} from 'collection-storage';

const db = await CollectionStorage.connect('memory://something');

// input keys must be 32 bytes, e.g.:
const rootKey = crypto.randomBytes(32); // store this between runs!

// Option 1: single key for all records
const enc1 = encryptByKey(rootKey);
const simpleCol1 = enc1(['foo'], db.getCollection('simple1'));

// Option 2: unique key per record, non-encrypted key
const keyCol2 = db.getCollection('keys2');
const enc2 = encryptByRecord(keyCol2, { keyCache: { capacity: 50 } });
const simpleCol2 = enc2(['foo'], db.getCollection('simple2'));

// Option 3 (recommended): unique key per record, encrypted using global key
const keyCol3 = db.getCollection('keys3');
const enc3 = encryptByRecordWithMasterKey(rootKey, keyCol3, {
  keyCache: { capacity: 50 },
});
const simpleCol3 = enc3(['foo'], db.getCollection('simple3'));

// option 3 is equivalent to:
const keyCol4 = encryptByKey(rootKey)(['key'], db.getCollection('keys4'));
const enc4 = encryptByRecord(keyCol4, { keyCache: { capacity: 50 } });
const simpleCol4 = enc4(['foo'], db.getCollection('simple4'));

// For all options, the encryption is transparent:
await simpleCol1.add({ id: 10, foo: 'This is encrypted' });
const value1 = await simpleCol1.where('id', 10).get();
// value1 is { id: 10, foo: 'This is encrypted' }
```

Notes:

- You cannot use encrypted columns in `.where()`
- By default, encryption and decryption is done _synchronously_ via the built-in
  `crypto` APIs.

To use another library for cryptography (e.g. to enable asynchronous
operations), you can provide a final parameter to the `encryptBy*` function:

```js
const myEncryption = {
  encrypt: async (key, input) => {
    // input (Buffer) => encrypted (Buffer)
  },

  decrypt: async (key, encrypted) => {
    // encrypted (Buffer) => value (Buffer)
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

const enc = encryptByKey(rootKey, { encryption: myEncryption });
```

## Compression

See the documentation for [compress](#compressed) below for details on enabling
automatic compression of record data.

## Per-record Migration

See the documentation for [migrate](#migrated) below for details on enabling
automatic migrations on a per-record basis.

## Caching

See the documentation for [cache](#cached) below for details on enabling
automatic caching of records.

## API

### CollectionStorage

#### `CollectionStorage.connect(url)`

```js
const db = await CollectionStorage.connect(url);
```

Connects to the given database and returns a database wrapper.

#### `CollectionStorage.dynamic(mappings)`

Registers one or more protocols to asynchronous loaders. If `connect` is called
with a URL that matches a registered protocol, the corresponding function is
invoked. This function is expected to register the handler for the protocol
(this is the default behaviour when importing standard database connector
libraries).

`mappings` is a list of tuples:

```js
import { CollectionStorage } from 'collection-storage';

CollectionStorage.dynamic([
  ['dynamodb', () => import('@collection-storage/dynamodb')],
  ['mongodb', () => import('@collection-storage/mongodb')],
  ['postgresql', () => import('@collection-storage/postgresql')],
  ['redis', () => import('@collection-storage/redis')],
  ['rediss', () => import('@collection-storage/redis')],
  ['sqlite', () => import('@collection-storage/sqlite')],
]);
```

Note: you cannot customise the protocol names - each connector will have one or
more expected protocol names which it must be mapped to.

#### `CollectionStorage.register(protocols, connector)`

Registers one or more protocols to a connector function. This is only needed if
you are creating a custom database connector; the standard connectors invoke
this internally when imported.

`protocols` is an array of strings (e.g. `['redis', 'rediss']`).

`connector` is a function which is given a URL (string) and returns an instance
which implements the `DB` interface.

### Database

#### `database.getCollection(name[, keys])`

```js
const collection = db.getCollection(name, {});
```

Initialises the requested collection in the database and returns a collection
wrapper. This is always a synchronous operation, but it may trigger asynchronous
background tasks to prepare the database. You can use the returned collection
immediately even if it is running background preparation tasks (any calls you
make will automatically wait for the preparation to complete).

`keys` is an optional object defining the searchable keys for the collection.
For example:

```js
const collection = db.getCollection(name, {
  someSimpleKey: {},
  someUniqueKey: { unique: true },
  anotherSimpleKey: {},
});
```

The `id` attribute is always indexed and should not be specified explicitly.

#### `database.close()`

```js
await db.close();
```

Disconnects from the database. Any in-progress operations will complete, but any
new operations will fail with an exception.

The database object cannot be reused after calling `close`.

The returned promise will resolve once all in-progress operations have completed
and all connections have fully closed.

### Collection

#### `collection.add()`

```js
await collection.add(...records);
```

Adds the given records to the collection. Each `record` should be an object with
an `id` and any other fields you wish to save.

#### `collection.all()`

[`collection.all`]: #collectionall

```js
const filtered = collection.all();
```

Filters for all records in the collection (see [`Filter`]).

#### `collection.where(attribute, value)`

[`collection.where`]: #collectionwhereattribute-value

```js
const filtered = collection.where(attribute, value);
```

Filters for records with `attribute` equal to `value` in the collection (see
[`Filter`]).

The `attribute` can be any indexed attribute (including `id`).

### Filter

[`Filter`]: #filter

Filters are returned by [`collection.all`] and [`collection.where`].

#### `filtered.get()`

[`filtered.get`]: #filteredget

```js
const record = await filtered.get();
```

Returns one (arbitrary) record matching the filter. If no records match, returns
`null`.

#### `filtered.values()`

[`filtered.values`]: #filteredvalues

```js
for await (const record of filtered.values()) {
}
```

Like [`filtered.get`], but returns an [`AsyncGenerator`] of all matching records
(if any).

Note that some database connectors perform cleanup (such as releasing a
connection back to the pool) when the generator completes. If you do not consume
the generator to completion, ensure you call [`iterator.return()`] on it to
trigger this behaviour (the `for await` syntax handles this for you if an error
is thrown, `break` is used, or the function returns, so the example usage above
is always safe. You only need to worry about calling `.return()` if you are
manually calling `.next()`, or if you discard the generator before passing it to
a `for await` loop).

For situations where you do not immediately pass the generator to `for await` or
a helper (such as [`Array.fromAsync`]), you should use a `try...finally` block:

```js
const recordGenerator = filtered.values();
try {
  // do complicated things with recordGenerator
  // (remember to await calls to ensure the finally block does not run prematurely)
} finally {
  await recordGenerator.return();
}
```

#### `filtered.count()`

```js
const count = await filtered.count();
```

Returns the number of matching records.

#### `filtered.exists()`

```js
const exists = await filtered.exists();
```

Returns `true` if at least one record matches the filter, otherwise returns
`false`.

#### `remove`

```js
const count = await filtered.remove();
```

Removes all records matching the filter.

Returns the number of records removed (0 if no records matched).

#### `update(delta[, options])`

```js
await filtered.update(delta, { upsert: false });
```

Updates all entries which match the filter. Any attributes not specified in
`delta` will remain unchanged. Note that this cannot be used with `.all()`.

When filtering on a non-unique index, only non-unique attributes can be
modified, even if the data contains only one matching record.

If `options` is `{ upsert: true }` and no records match the filter, a new record
will be added. `upsert` can only be used when filtering by `id`.

### `filtered.attrs(attributes)`

```js
const projected = filtered.attrs(attributes);
```

Limits the attributes which will be returned from this query. Only those named
in `attributes` will be included.

The returned object supports [`filtered.get`] and [`filtered.values`].

Example usage:

```js
const record = await collection.where('id', 10).attrs(['foo', 'bar']).get();
// record contains { foo: ?, bar: ? } but no other attributes
```

### Encrypted

#### `encryptByKey`

```js
const enc = encryptByKey(key, [options]);
const collection = enc(['encryptedField', 'another'], baseCollection);
```

Returns a function which can wrap collections with encryption.

By default the provided `key` should be a 32-byte buffer. If custom encryption
is used, the key should conform to its expectations.

See example notes above for an example on using `options.encryption`.

If `options.allowRaw` is `true`, unencrypted values will be passed through. This
can be useful when migrating old columns to use encryption. Note that buffer
(binary) data will _always_ be decrypted; never passed through.

#### `encryptByRecord`

```js
const enc = encryptByRecord(keyCollection, [options]);
const collection = enc(['myEncryptedField', 'another'], baseCollection);
```

Returns a function which can wrap collections with encryption.

Stores one key per ID in `keyCollection` (unencrypted). If `options.keyCache` is
provided, uses a least-recently-used cache for keys to reduce database access.
`keyCache` should be set to an object which contains the settings described for
[cache](#cached).

Updating a record re-encrypts using the same key. Removing records also removes
the corresponding keys.

See example notes above for an example on using `options.encryption`.

If `options.allowRaw` is `true`, unencrypted values will be passed through. This
can be useful when migrating old columns to use encryption. Note that buffer
(binary) data will _always_ be decrypted; never passed through.

#### `encryptByRecordWithMasterKey`

```js
const enc = encryptByRecordWithMasterKey(masterKey, keyCollection, [options]);
const collection = enc(['myEncryptedField', 'another'], baseCollection);
```

Returns a function which can wrap collections with encryption.

Stores one key per ID in `keyCollection` (encrypted using `masterKey`). If
`options.keyCache` is provided, uses a least-recently-used cache for keys to
reduce database access. `keyCache` should be set to an object which contains the
settings described for [cache](#cached).

This is equivalent to:

```js
const keys = encryptByKey(masterKey, [options])(keyCollection, ['key']);
const enc = encryptByRecord(keys, [options]);
const collection = enc(['myEncryptedField', 'another'], baseCollection);
```

See example notes above for an example on using `options.encryption`.

### Compressed

#### `compress`

```js
const collection = compress(['compressedField', 'another'], baseCollection);
```

Wraps a collection with compression. Uses gzip compression and ensures that
short uncompressable messages will not grow significantly (2 bytes maximum).

If you apply compression to an existing column, old (uncompressed) values will
be passed through automatically (except binary data). To disable this
functionality, pass `allowRaw: false`:

```js
const collection = compress(['value'], baseCollection, { allowRaw: false });
```

If you are migrating a column which contains binary data, you should probably
migrate the data to add compression (or at least prefix all values with a 0x00
byte to mark them uncompressed). If this is not possible, you can pass
`allowRawBuffer: true` to `compress` but **note**: any data which begins with
`0x00` will have that byte stripped. Additionally, any data which happens to
start with `0x1f 0x8b` (the gzip "magic number") will be passed through
`zlib.gunzip`. Enabling `allowRawBuffer` is provided as an escape hatch, but is
_not recommended_.

Do not apply compression to short values, or values with no compressible
structure (e.g. pre-compressed images, random data); it will increase the size
rather than reduce it. By default, compression is not attempted for values which
are less than 200 bytes. You can change this with
`options.compressionThresholdBytes`; smaller values may result in minor byte
savings, but will require more CPU (note that there is no point setting the
threshold less than 12 as gzip always adds 11 bytes of overhead).

##### `compress` & `encrypt`

If you want to use compression in combination with encryption, note that you
should compress _then_ encrypt. Once data has been encrypted, compression will
have little effect. Also beware: if your application allows writing part of a
compressed field, and the database is exposed, it will be possible for an
attacker to use compression, along with observation of the resulting record
size, to guess secrets from the same value which may otherwise be hidden to
them. Data in separate fields which an attacker cannot control will remain safe,
even if compressed. This is a rare situation but should be considered when
encrypting any compressed data.

```js
const fields = ['field', 'another'];
const enc = encryptByKey(key);
// be sure to apply compression and encryption in the correct order!
const collection = compress(fields, enc(fields, baseCollection));
```

### Cached

#### `cache`

```js
const collection = cache(baseCollection, [options]);
```

Wraps a collection with read caching. Writes will still be recorded immediately
and will be reflected in the cached data, but changes made by other clients will
not be returned until the cache is deemed stale.

This adds a small overhead to the backing collection as it will fetch the ID
attribute for most operations even if not requested, but the ability to return
cached data should outweigh this cost in almost all cases.

By default, records in the cache never expire (unless found to be invalid when
performing other operations, such as successfully reusing a unique index value)
and the cache has an unlimited size. In real applications, this is unlikely to
be desirable. You can configure the cache with the `options` object:

```js
const collection = cache(baseCollection, {
  capacity: 128, // number of records to store (oldest records are removed)
  maxAge: 1000, // max age in milliseconds
});
```

`capacity` and `maxAge` default to infinity. Note that records which expire due
to `maxAge` will _not_ be removed from the cache automatically. You should
specify a `capacity` to keep the cache from growing infinitely even when using a
`maxAge`.

If you want to test situations where the cache has expired, you can also specify
`time`. This should be a function compatible with the `Date.now` signature
(`Date.now` is the default).

### Migrated

#### `migrate`

```js
const collection = migrate(
  {
    migratedField: (stored) => newValue,
    another: (stored) => newValue,
  },
  baseCollection,
);
```

```js
const collection = migrate(
  ['versionColumn'],
  {
    migratedField: (stored, { versionColumn }) => newValue,
    another: (stored, { versionColumn }) => newValue,
  },
  baseCollection,
);
```

Wraps a collection with an automatic on-fetch migration. The migrations will be
applied whenever records are read, but will not be saved back into the database.
The migration functions are per-field, taking in the old field value and
returning an updated field value. Each function will only be invoked if the user
requested that particular field.

If version information is required to decide whether to migrate or not,
additional fields to fetch can be specified and these will be made available to
all migration functions in the second function parameter. It is up to you to
write the appropriate version to this field when adding or updating values. You
can specify as many extra fields as you need (e.g. to allow one version field
for each field, or to include other fields which are used to derive new values).

## Compatibility

All storage options work in the same way with some minor differences in accepted
data. Currently the only known difference is that some storage options allow
null bytes (`\x00`) in collection names, indices, attribute names, or text
values, while other storage options reject them in one or more of these places.
To ensure best compatibility, do not use null bytes in any strings.

## Security

This library is designed to work with untrusted input; you do not need to
perform any data sanitising. Note that collection and index names, though
technically safe to set to any value, should not be set from untrusted data.

[`AsyncGenerator`]:
  https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AsyncGenerator
[`iterator.return()`]:
  https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols#returnvalue_2
[`Array.fromAsync`]:
  https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/fromAsync
