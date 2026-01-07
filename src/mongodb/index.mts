import { CollectionStorage } from 'collection-storage/index.mts';
import { MongoDB } from './MongoDB.mts';

CollectionStorage.register(['mongodb'], MongoDB.connect);

export { MongoDB };
