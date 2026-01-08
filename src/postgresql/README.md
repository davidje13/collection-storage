# Collection Storage PostgreSQL Connector

This is a database connector for
[collection-storage](https://www.npmjs.com/package/collection-storage). See the
main project's documentation for general usage.

## Install dependency

```sh
npm install --save collection-storage @collection-storage/postgresql
```

For synchronous access:

```js
import '@collection-storage/postgresql';
```

Or, for dynamic access (only loaded if / when used):

```js
import { CollectionStorage } from 'collection-storage';

CollectionStorage.dynamic([
  ['postgresql', () => import('@collection-storage/postgresql')],
]);
```

## Connection String

```
postgresql://[username:password@]host[:port]/database[?options]
```

Options can include `ssl=true`, `sslcert=<cert-file-path>`,
`sslkey=<key-file-path>`, `sslrootcert=<root-file-path>`. For other options, see
the config keys in the
[pg-connection-string documentation](https://www.npmjs.com/package/pg-connection-string#tcp-connections).
