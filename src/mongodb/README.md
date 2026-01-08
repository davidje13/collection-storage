# Collection Storage MongoDB Connector

This is a database connector for
[collection-storage](https://www.npmjs.com/package/collection-storage). See the
main project's documentation for general usage.

## Install dependency

```sh
npm install --save collection-storage @collection-storage/mongodb
```

For synchronous access:

```js
import '@collection-storage/mongodb';
```

Or, for dynamic access (only loaded if / when used):

```js
import { CollectionStorage } from 'collection-storage';

CollectionStorage.dynamic([
  ['mongodb', () => import('@collection-storage/mongodb')],
  ['mongodb+srv', () => import('@collection-storage/mongodb')],
]);
```

## Connection String

```
mongodb://[username:password@]host1[:port1][,...hostN[:portN]][/[database][?options]]
mongodb+srv://[username:password@]host[:port][/[database][?options]]
```

See the
[mongo documentation](https://docs.mongodb.com/manual/reference/connection-string/)
for full details.
