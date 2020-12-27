export declare function safeAdd<K extends keyof any, V>(o: Record<K, V>, k: K, value: V): void;
declare function safeGet<T, K extends keyof T>(o: T, k: K): T[K] | undefined;
declare function safeGet(o: object, k: string): unknown;
export { safeGet };
export declare function makeKeyValue<V>(key: string, value: V): {
    [k: string]: V;
};
export declare function mapEntries<K extends keyof any, A, B>(input: Record<K, A>, map: (a: A) => B, keyMapper?: (k: K) => K): Record<K, B>;
//# sourceMappingURL=safeAccess.d.ts.map