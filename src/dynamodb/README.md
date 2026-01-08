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

## Specifying provisioned capacity for DynamoDB

When using DynamoDB, it is possible to specify explicit read/write capacity for
each table. By default, all tables are configured as pay-per-request. Note that
this will only affect the initial table creation; no automatic migration of
provisioned capacity is currently applied.

Typically it is recommended to start with pay-per-request (the default) and
configure provisioned capacity once you know what the usage of your tables will
be in production. This can be done outside the application, either using the AWS
console manually, or the CLI for automation. But if you know the usage in
advance and want to specify it on table creation, this library allows you to do
so.

To specify explicit provisioned capacities, either:

- Specify capacities in the connection string:

  ```
  - Only do this if you know what you are doing!
  - If used incorrectly, this can make DynamoDB cost more.
  dynamodb://dynamodb.eu-west-1.amazonaws.com/
    ?provision_my-hot-table=10.2
    &provision_my-hot-table_index_my-special-index=2.1
    &provision_my-hot-table_index=4.2
    &provision=-
  ```

  (newlines added for clarity, but must not be present in the actual connection
  string)

  The formats recognised are:

  ```
  fallback for all tables and indices:
  provision=<read>.<write>

  explicit config for <table-name>:
  provision_<table-name>=<read>.<write>

  fallback for all indices of <table-name>:
  provision_<table-name>_index=<read>.<write>

  explicit config for <index-name> of <table-name>:
  provision_<table-name>_index_<index-name>=<read>.<write>
  ```

  Setting any property to a dash (`-`) will use pay-per-request billing.

- Or, if calling `DynamoDb.connect` directly, you can specify a function as the
  second parameter to allow programmatic control:

  ```js
  function myThroughput(tableName, indexName) {
    // Only do this if you know what you are doing!
    // If used incorrectly, this can make DynamoDB cost more.
    switch (tableName) {
      case 'my-hot-table':
        switch (indexName) {
          case null:
            // applies to the table my-hot-table
            return { read: 10, write: 2 };
          case 'my-special-index':
            // applies to my-special-index for my-hot-table
            return { read: 2, write: 1 };
          default:
            // applies to all other indices for my-hot-table
            return { read: 4, write: 2 };
        }
      default:
        // applies to all other tables and indices
        return null; // use pay-per-request
    }
  }

  const db = DynamoDb.connect('dynamodb://etc', myThroughput);
  ```

  The function is called once with a `null` index name for the base table
  properties, and once per index for the index properties.

  Returning `null` or `undefined` will cause that table to use pay-per-request
  billing.

Notes for both methods:

- Table names and index names will be the raw names before any common prefix is
  added.

- Unique indices are all bundled into a single table, so the provisioned values
  for these are summed together for that table.

- The provisioned units should always be integers, but are automatically rounded
  (using `ceil`) and clamped to a minimum of 1.

- DynamoDB does not allow using a mix of provisioned and pay-per-request billing
  for a table and its indices. Set each table and its indices either all
  pay-per-request or all provisioned.
