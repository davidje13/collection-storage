import type { Collection, KeyOptions } from './Collection';
import type { IDable } from './IDable';
export declare type DBKeys<T> = {
    [K in string & keyof T]?: KeyOptions;
};
export interface DB {
    getCollection<T extends IDable>(name: string, keys?: DBKeys<T>): Collection<T>;
    close(): Promise<void> | void;
}
//# sourceMappingURL=DB.d.ts.map