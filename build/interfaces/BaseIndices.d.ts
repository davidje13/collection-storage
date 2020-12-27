import type { Indices } from './Collection';
import type { IDable } from './IDable';
import type { DBKeys } from './DB';
export default class BaseIndices<T extends IDable> implements Indices<T> {
    private readonly keys;
    constructor(keys: DBKeys<T>);
    getIndices(): (string & keyof T)[];
    getUniqueIndices(): (string & keyof T)[];
    getCustomIndices(): (string & keyof T)[];
    isIndex(attribute: string | keyof T): boolean;
    isUniqueIndex(attribute: string | keyof T): boolean;
}
//# sourceMappingURL=BaseIndices.d.ts.map