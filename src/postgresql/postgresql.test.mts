import { Client } from 'pg';
import { PostgresDB } from './PostgresDB.mts';
import { contract } from '../test-helpers/db.contract-test.mts';

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

describe('PostgresDB', () => {
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

  contract({ factory: () => PostgresDB.connect(url) });
});
