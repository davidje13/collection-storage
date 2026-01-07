# Collection Storage Redis Connector

This is a database connector for
[collection-storage](https://www.npmjs.com/package/collection-storage). See the
main project's documentation for general usage.

**warning**: Redis support is experimental and the database format is likely to
change in later versions.

## Install dependency

```sh
npm install --save collection-storage @collection-storage/redis
```

For synchronous access:

```js
import '@collection-storage/redis';
```

Or, for dynamic access (only loaded if / when used):

```js
import { CollectionStorage } from 'collection-storage';

CollectionStorage.dynamic([
  ['redis', () => import('@collection-storage/redis')],
  ['rediss', () => import('@collection-storage/redis')],
]);
```

## Connection String

```
redis://[username:password@]host[:port][/[database-index][?options]]
rediss://[username:password@]host[:port][/[database-index][?options]]
```

See the [ioredis documentation](https://github.com/luin/ioredis#readme) for more
details.

## Limitations

Note that this connector does not currently support migrating indices. If you
add a new index, it will be updated for newly added data, but existing data will
not be included. If you remove an index, it will stop being used but the backing
data for it will remain.
