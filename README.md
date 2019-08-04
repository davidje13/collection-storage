# Collection Storage

Provides an abstraction layer around communication with a
collection-based database. This makes switching database choices easier
during deployments and testing.

Currently supports MongoDB and in-memory storage.

## Install dependency

```bash
npm install --save git+https://github.com/davidje13/collection-storage.git#semver:^1.0.2
```

If you want to connect to a Mongo database, you will also need to add a
dependency on `mongodb`:

```bash
npm install --save mongodb
```

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

Updates one entry which matches `searchAttr = searchValue`. Any
attributes not specified in `update` will remain unchanged.

If `options` is `{ upsert: true }` and no values match the search, a
new entry will be added.

#### `get`

```javascript
const value = await collection.get(searchAttr, searchValue, [attrs]);
```

Returns one entry which matches `searchAttr = searchValue`. If `attrs`
is specified, only the attributes listed will be returned (by default,
all attributes are returned).

`attrs` is an optional list of strings denoting the attributes to
return.

If no values match, returns `null`.

#### `getAll`

```javascript
const values = await collection.getAll(searchAttr, searchValue, [attrs]);
```

Like `get`, but returns a list of all matching values. If no values
match, returns an empty list.

## Development

To run the test suite, you will need to have a local installation of
MongoDB. By default, the tests will connect to
`mongodb://localhost:27017/collection-storage-tests`. You can change
this if required by setting the `MONGO_URL` environment variable.

On macOS, MongoDB can be installed with:

```bash
brew install mongodb
brew services start mongodb
```

On Ubuntu, it can be installed with:

```bash
apt install mongodb
```
