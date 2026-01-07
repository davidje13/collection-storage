# Collection Storage DynamoDB Connector

This is a database connector for
[collection-storage](https://www.npmjs.com/package/collection-storage). See the
main project's documentation for general usage.

## Install dependency

```sh
npm install --save collection-storage @collection-storage/dynamodb
```

For synchronous access:

```js
import '@collection-storage/dynamodb';
```

Or, for dynamic access (only loaded if / when used):

```js
import { CollectionStorage } from 'collection-storage';

CollectionStorage.dynamic([
  ['dynamodb', () => import('@collection-storage/dynamodb')],
]);
```

## Connection String

```
dynamodb://[key:secret@]dynamodb.region.amazonaws.com[:port]/[table-prefix-][?options]
```

See the
[AWS documentation](https://docs.aws.amazon.com/general/latest/gr/rande.html)
for a list of region names. Requests will use `https` by default. Specify
`tls=false` in the options to switch to `http` (e.g. when using DynamoDB Local
for testing.)

By default, eventually-consistent reads are used. To use strongly-consistent
reads, specify `consistentRead=true` (note that this will use twice as much read
capacity for the same operations).

To configure read/write capacity for tables, see the section below (but note
that it is recommended to keep the default pay-per-request and configure
provisioned throughput externally once the usage is known).
