import type AWS from './AWS';
export interface Results<I> {
    batched(consumer: (items: Readonly<I[]>) => (Promise<void> | void)): Promise<void> | void;
    all(): Promise<Readonly<I[]>> | Readonly<I[]>;
}
export declare class Paged<K, I> implements Results<I> {
    private readonly aws;
    private readonly fn;
    private readonly pageLimit;
    constructor(aws: AWS, fn: (start: K | undefined) => Promise<[I[], K]>, pageLimit?: number);
    batched(consumer: (items: I[]) => (Promise<void> | void)): Promise<void>;
    all(): Promise<I[]>;
}
//# sourceMappingURL=Results.d.ts.map