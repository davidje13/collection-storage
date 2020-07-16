/// <reference types="node" />
import type { IDable } from '../interfaces/IDable';
import type { Collection } from '../interfaces/Collection';
import { Wrapped } from './WrappedCollection';
declare type CompressableKeys<T> = readonly (keyof Omit<T, 'id'> & string)[];
export declare type Compressed<T extends IDable, WF extends keyof T> = Wrapped<T, WF, Buffer>;
export interface CompressOptions {
    allowRaw?: boolean;
    allowRawBuffer?: boolean;
    compressionThresholdBytes?: number;
}
export declare function compress<T extends IDable, F extends CompressableKeys<T>>(fields: F, baseCollection: Collection<Compressed<T, F[-1]>>, options?: CompressOptions): Collection<T>;
export {};
//# sourceMappingURL=compressed.d.ts.map