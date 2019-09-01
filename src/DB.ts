import Collection, { KeyOptions } from './Collection';
import IDable from './IDable';

export type DBKeys<T> = {
  [K in keyof T & string]?: KeyOptions;
};

export default interface DB {
  getCollection<T extends IDable>(
    name: string,
    keys?: DBKeys<T>,
  ): Collection<T>;
}
