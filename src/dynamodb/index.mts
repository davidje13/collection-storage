import { CollectionStorage } from '../core/index.mts';
import { DynamoDB } from './DynamoDB.mts';

CollectionStorage.register(['dynamodb'], DynamoDB.connect);

export { DynamoDB };
