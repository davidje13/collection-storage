import { CollectionStorage } from 'collection-storage/index.mts';
import { DynamoDB } from './DynamoDB.mts';

CollectionStorage.register(['dynamodb'], DynamoDB.connect);

export { DynamoDB };
