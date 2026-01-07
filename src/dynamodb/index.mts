import { CollectionStorage } from 'collection-storage';
import { DynamoDB } from './DynamoDB.mts';

CollectionStorage.register(['dynamodb'], DynamoDB.connect);

export { DynamoDB };
