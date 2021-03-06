import { Client } from 'pg';
import PostgresDb from './PostgresDb';
import contract from '../db.contract-test';

const url = process.env.PSQL_URL || 'postgresql://localhost:5432/collection-storage-tests';

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

// database can take a moment to warm up if cold
jest.setTimeout(10000);

describe('PostgresDb', () => contract({
  beforeAll: async (): Promise<void> => {
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
  },
  factory: (): Promise<PostgresDb> => PostgresDb.connect(url),
}));
