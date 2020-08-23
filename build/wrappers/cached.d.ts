import type { Collection } from '../interfaces/Collection';
import type { IDable } from '../interfaces/IDable';
export interface CacheOptions {
    capacity?: number;
    maxAge?: number;
    time?: () => number;
}
export declare function cache<T extends IDable>(baseCollection: Collection<T>, options?: CacheOptions): Collection<T>;
//# sourceMappingURL=cached.d.ts.map