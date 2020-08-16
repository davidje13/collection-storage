import DynamoCollection, { Throughput } from './DynamoCollection';
import AWS from './api/AWS';
import { DDB, escapeName } from './api/DDB';
import type { DBKeys } from '../interfaces/DB';
import BaseDB from '../interfaces/BaseDB';
import type { IDable } from '../interfaces/IDable';

export type DbThroughputFn = (
  tableName: string,
  indexName: string | null,
) => Throughput | null | undefined;

const makeThroughputFn = (params: URLSearchParams) => (
  tableName: string,
  indexName: string | null,
): Throughput | null => {
  let throughput: string | null = null;
  if (indexName) {
    throughput = (
      params.get(`provision_${tableName}_index_${indexName}`) ||
      params.get(`provision_${tableName}_index`) ||
      params.get(`provision_${tableName}`) ||
      params.get('provision')
    );
  } else {
    throughput = (
      params.get(`provision_${tableName}`) ||
      params.get('provision')
    );
  }
  if (!throughput || throughput === '-') {
    return null;
  }
  const parts = throughput.split('.');
  if (parts.length !== 2) {
    throw new Error(`unexpected provisioning format for ${tableName} ${indexName || ''}: ${throughput} (expected 'read.write' or '-')`);
  }
  return {
    read: Number.parseInt(parts[0], 10),
    write: Number.parseInt(parts[1], 10),
  };
};

export default class DynamoDb extends BaseDB {
  private constructor(
    private readonly aws: AWS,
    private readonly ddb: DDB,
    tableNamePrefix: string,
    throughputFn?: DbThroughputFn,
  ) {
    super((name, keys) => new DynamoCollection(
      this.ddb,
      tableNamePrefix + escapeName(name),
      keys,
      throughputFn?.bind(null, name),
    ));
  }

  public static connect(url: string, throughputFn?: DbThroughputFn): DynamoDb {
    const parsed = new URL(url);
    let key;
    let secret;
    if (parsed.username) {
      key = parsed.username;
      secret = parsed.password;
    } else {
      key = process.env.AWS_ACCESS_KEY_ID;
      secret = process.env.AWS_SECRET_ACCESS_KEY;
    }
    if (!key || !secret) {
      throw new Error('No AWS key / secret specified');
    }
    const protocol = (parsed.searchParams.get('tls') === 'false') ? 'http' : 'https';
    const consistentRead = (parsed.searchParams.get('consistentRead') === 'true');
    const tableNamePrefix = parsed.pathname.substr(1);

    const aws = new AWS(key, secret);
    const ddb = new DDB(aws, `${protocol}://${parsed.host}`, { consistentRead });
    return new DynamoDb(
      aws,
      ddb,
      tableNamePrefix,
      throughputFn || makeThroughputFn(parsed.searchParams),
    );
  }

  public getCollection<T extends IDable>(name: string, keys?: DBKeys<T>): DynamoCollection<T> {
    return super.getCollection(name, keys) as DynamoCollection<T>;
  }

  public getDDB(): DDB {
    return this.ddb;
  }

  protected internalClose(): Promise<void> {
    return this.aws.close();
  }
}
