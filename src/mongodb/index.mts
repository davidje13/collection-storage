import { CollectionStorage } from '../core/index.mts';
import { MongoDB } from './MongoDB.mts';

CollectionStorage.register(['mongodb'], MongoDB.connect);

export { MongoDB };
