import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { PostgresDB } from './PostgresDB.mts';
import { contract, migrationContract } from '../test-helpers/db.contract-test.mts';
import { makeWrappedDB } from '../test-helpers/makeWrappedDB.mts';
import { cache, compress, encryptByKey, type IDable } from '../core/index.mts';

const url =
  process.env['PSQL_URL'] ||
  'postgresql://postgres:password@localhost:5432/collection-storage-tests';

function urlForDb(base: string, db: string): string {
  const dbUrl = new URL(base);
  dbUrl.pathname = db;
  return String(dbUrl);
}

function getDbName(dbUrl: string): string {
  return new URL(dbUrl).pathname.substr(1);
}

const ESCAPE_REG = /"/g;
function quoteIdentifier(msg: string): string {
  return `"${msg.replace(ESCAPE_REG, '""')}"`;
}

beforeAll(async () => {
  const dbName = getDbName(url);
  const quotedDbName = quoteIdentifier(dbName);

  const root = new Client({
    connectionString: urlForDb(url, 'postgres'),
  });
  await root.connect();
  try {
    await root.query(`DROP DATABASE IF EXISTS ${quotedDbName}`);
    await root.query(`CREATE DATABASE ${quotedDbName}`);
  } finally {
    await root.end();
  }
});

describe('PostgresDB contract', () => {
  contract({ factory: () => PostgresDB.connect(url) });
});

describe('PostgresDB migration contract', () => {
  migrationContract({ factory: () => () => PostgresDB.connect(url) });
});

describe('PostgresDB cached', () => {
  contract({
    factory: async () =>
      makeWrappedDB(await PostgresDB.connect(url), (base) =>
        cache(base, { capacity: 10, maxAge: 5000 }),
      ),
  });
});

describe('PostgresDB compressed', () => {
  contract({
    factory: async () =>
      makeWrappedDB(await PostgresDB.connect(url), (base) => compress(['value'], base)),
  });
});

describe('PostgresDB encrypted', () => {
  const enc = encryptByKey(randomBytes(32));

  contract({
    factory: async () =>
      makeWrappedDB(await PostgresDB.connect(url), (base) =>
        enc<IDable & Record<string, unknown>>()(['value'], base),
      ),
  });
});
