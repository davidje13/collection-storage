import { CollectionStorage } from '../core/index.mts';
import { MongoDB } from './MongoDB.mts';

CollectionStorage.register(['mongodb', 'mongodb+srv'], MongoDB.connect);

export { MongoDB };
