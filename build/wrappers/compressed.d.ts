/// <reference types="node" />
import type { IDable } from '../interfaces/IDable';
import type { Collection } from '../interfaces/Collection';
import { Wrapped } from './WrappedCollection';
declare type CompressableKeys<T> = readonly (keyof Omit<T, 'id'> & string)[];
export interface CompressOptions {
    allowRaw?: boolean;
    allowRawBuffer?: boolean;
}
export declare function compress<T extends IDable, F extends CompressableKeys<T>>(fields: F, baseCollection: Collection<Wrapped<T, F[-1], Buffer>>, options?: CompressOptions): Collection<T>;
export {};
//# sourceMappingURL=compressed.d.ts.map