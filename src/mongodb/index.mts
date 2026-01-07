import { CollectionStorage } from 'collection-storage';
import { MongoDB } from './MongoDB.mts';

CollectionStorage.register(['mongodb'], MongoDB.connect);

export { MongoDB };
