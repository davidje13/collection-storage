import DynamoCollection from './DynamoCollection';
import AWS from './api/AWS';
import { DDB, escapeName } from './api/DDB';
import type { DBKeys } from '../interfaces/DB';
import BaseDB from '../interfaces/BaseDB';
import type { IDable } from '../interfaces/IDable';

export default class DynamoDb extends BaseDB {
  private constructor(
    private readonly aws: AWS,
    private readonly ddb: DDB,
    tableNamePrefix: string,
  ) {
    super((name, keys) => new DynamoCollection(
      this.ddb,
      tableNamePrefix + escapeName(name),
      keys,
    ));
  }

  public static connect(url: string): DynamoDb {
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
    return new DynamoDb(aws, ddb, tableNamePrefix);
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
