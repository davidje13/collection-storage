import CollectionStorage from './CollectionStorage';
import DB from './DB';
import Collection from './Collection';
import IDable from './IDable';
export declare type DB = DB;
export declare type Collection<T extends IDable> = Collection<T>;
export { default as MemoryDb } from './memory/MemoryDb';
export { default as MongoDb } from './mongo/MongoDb';
export default CollectionStorage;
