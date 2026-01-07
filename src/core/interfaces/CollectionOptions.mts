import type { DBKeys } from './DB.mts';

export interface CollectionOptions<T> {
  name: string;
  keys: DBKeys<T>;
  state: { readonly closed: boolean };
}
