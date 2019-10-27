export declare type IDType = number | string;
export interface IDableBy<ID extends IDType> {
    id: ID;
}
declare type IDable = IDableBy<IDType>;
export default IDable;
//# sourceMappingURL=IDable.d.ts.map