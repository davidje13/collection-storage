import { type DBKeys, type IDable, BaseDB } from '../core/index.mts';
import { AWS } from './api/AWS.mts';
import { DDB, escapeName } from './api/DDB.mts';
import { DynamoCollection, type Throughput } from './DynamoCollection.mts';

export type DbThroughputFn = (
  tableName: string,
  indexName: string | null,
) => Throughput | null | undefined;

const makeThroughputFn =
  (params: URLSearchParams) =>
  (tableName: string, indexName: string | null): Throughput | null => {
    let throughput: string | null = null;
    if (indexName) {
      throughput =
        params.get(`provision_${tableName}_index_${indexName}`) ||
        params.get(`provision_${tableName}_index`) ||
        params.get(`provision_${tableName}`) ||
        params.get('provision');
    } else {
      throughput = params.get(`provision_${tableName}`) || params.get('provision');
    }
    if (!throughput || throughput === '-') {
      return null;
    }
    const parts = throughput.split('.');
    if (parts.length !== 2) {
      throw new Error(
        `unexpected provisioning format for ${tableName} ${indexName || ''}: ${throughput} (expected 'read.write' or '-')`,
      );
    }
    return {
      read: Number.parseInt(parts[0]!, 10),
      write: Number.parseInt(parts[1]!, 10),
    };
  };

export class DynamoDB extends BaseDB {
  /** @internal */ declare private readonly _aws: AWS;
  /** @internal */ declare private readonly _ddb: DDB;
  /** @internal */ declare private readonly _tableNamePrefix: string;
  /** @internal */ declare private readonly _throughputFn: DbThroughputFn | undefined;

  private constructor(aws: AWS, ddb: DDB, tableNamePrefix: string, throughputFn?: DbThroughputFn) {
    super();
    this._aws = aws;
    this._ddb = ddb;
    this._tableNamePrefix = tableNamePrefix;
    this._throughputFn = throughputFn;
  }

  /** @internal */ protected override internalClose() {
    return this._aws.close();
  }

  static connect(url: string, throughputFn?: DbThroughputFn): DynamoDB {
    const parsed = new URL(url);
    let key;
    let secret;
    if (parsed.username) {
      key = parsed.username;
      secret = parsed.password;
    } else {
      key = process.env['AWS_ACCESS_KEY_ID'];
      secret = process.env['AWS_SECRET_ACCESS_KEY'];
    }
    if (!key || !secret) {
      throw new Error('No AWS key / secret specified');
    }
    const protocol = parsed.searchParams.get('tls') === 'false' ? 'http' : 'https';
    const consistentRead = parsed.searchParams.get('consistentRead') === 'true';
    const tableNamePrefix = parsed.pathname.substr(1);

    const aws = new AWS(key, secret);
    const ddb = new DDB(aws, `${protocol}://${parsed.host}`, {
      consistentRead,
    });
    return new DynamoDB(
      aws,
      ddb,
      tableNamePrefix,
      throughputFn || makeThroughputFn(parsed.searchParams),
    );
  }

  getCollection<T extends IDable>(name: string, keys?: DBKeys<T>): DynamoCollection<T> {
    return this.get(
      name,
      keys,
      (options) =>
        new DynamoCollection(
          options,
          this._ddb,
          this._tableNamePrefix + escapeName(options.name),
          this._throughputFn?.bind(null, options.name),
        ),
    );
  }

  getDDB(): DDB {
    return this._ddb;
  }
}
