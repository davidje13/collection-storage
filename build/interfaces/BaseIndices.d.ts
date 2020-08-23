import type { Indices } from './Collection';
import type { DBKeys } from './DB';
export default class BaseIndices implements Indices {
    private readonly keys;
    constructor(keys: DBKeys<any>);
    getIndices(): string[];
    getUniqueIndices(): string[];
    getCustomIndices(): string[];
    isIndex(attribute: string): boolean;
    isUniqueIndex(attribute: string): boolean;
}
//# sourceMappingURL=BaseIndices.d.ts.map