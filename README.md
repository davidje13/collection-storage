# Collection Storage

Provides an abstraction layer around communication with a collection-based
database. This makes switching database choices easier during deployments and
testing.

For user documentation, see the [Core README](./src/core/README.md) and the
[API documentation](./docs/API.md).

## Contributing

To run the test suite, you will need to have a local installation of MongoDB,
Redis, PostgreSQL and DynamoDB Local, and configure environment variables to
reference them. The defaults are:

```
MONGO_URL=mongodb://localhost:27017/collection-storage-tests
REDIS_URL=redis://localhost:6379/15
PSQL_URL=postgresql://postgres:password@localhost:5432/collection-storage-tests
DDB_URL=dynamodb://key:secret@localhost:8000/collection-storage-tests-?tls=false&consistentRead=true
```

**warning**: By default, this will flush any Redis database at index 15. If you
have used database 15 for your own data, you should set `REDIS_URL` to use a
different database index.

**note**: The PostgreSQL tests will connect to the given server's `postgres`
database to drop (if necessary) and re-create the specified test database. You
do not need to create the test database yourself.

**note**: For the tests, you must set the `consistentRead` flag on the DynamoDB
connection, otherwise the consumed capacity will not match the expected values.

The target databases can be started using Docker if not installed locally:

```sh
docker run -d --rm -p 127.0.0.1:27017:27017 mongo:8
docker run -d --rm -p 127.0.0.1:6379:6379 redis:8-alpine
docker run -d --rm -p 127.0.0.1:5432:5432 -e POSTGRES_PASSWORD=password postgres:18-alpine
docker run -d --rm -p 127.0.0.1:8000:8000 amazon/dynamodb-local:latest
```

If you wish to run these services on a networked machine or a VM, you can use
SSH port forwarding to make them available to your development workstation
without needing to make them available to all computers on the network:

```sh
ssh -N -L 27017:localhost:27017 -L 6379:localhost:6379 -L 5432:localhost:5432 -L 8000:localhost:8000 [user]@[address]
```
