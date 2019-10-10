import DB from './interfaces/DB';
interface ConfigT {
    beforeAll?: () => Promise<void> | void;
    factory: () => Promise<DB> | DB;
    afterAll?: () => Promise<void> | void;
}
declare const _default: ({ beforeAll: beforeAllFn, factory, afterAll: afterAllFn, }: ConfigT) => void;
export default _default;
