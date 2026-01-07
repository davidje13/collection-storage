# Collection Storage SQLite Connector

This is a database connector for
[collection-storage](https://www.npmjs.com/package/collection-storage). See the
main project's documentation for general usage.

## Install dependency

```sh
npm install --save collection-storage @collection-storage/sqlite
```

For synchronous access:

```js
import '@collection-storage/sqlite';
```

Or, for dynamic access (only loaded if / when used):

```js
import { CollectionStorage } from 'collection-storage';

CollectionStorage.dynamic([
  ['sqlite', () => import('@collection-storage/sqlite')],
]);
```

Note that this requires Node.js 22.13+.

## Connection String

```
sqlite://[path][?options]
```

The `options` can include:

- `timeout=n` the [busy timeout](https://sqlite.org/c3ref/busy_timeout.html) (in
  milliseconds)

Notes:

- if no path is given, an in-memory SQLite database is used (`memory://` is a
  better choice for in-memory storage unless you have a specific reason to use
  SQLite)
- only absolute paths are permitted, i.e. valid URLs have 3 `/`s at the start:
  `sqlite:///foo/bar`
- due to the nature of SQLite, you _must not_ have multiple processes connected
  to the same database file simultaneously
- internally this uses Node's built-in
  [DatabaseSync](https://nodejs.org/api/sqlite.html#class-databasesync), which
  performs queries synchronously on the main thread. This means that
  long-running queries can block the entire application. Ensure you set a
  `timeout` to avoid potential denial-of-service.
