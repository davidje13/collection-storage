declare const _default: (shouldRetry: (e: any) => boolean, { timeoutMillis, initialDelayMillis, maxDelayMillis, delayGrowth, jitter, }?: {
    timeoutMillis?: number | undefined;
    initialDelayMillis?: number | undefined;
    maxDelayMillis?: number | undefined;
    delayGrowth?: number | undefined;
    jitter?: boolean | undefined;
}) => <T>(fn: () => T | Promise<T>) => Promise<T>;
export default _default;
//# sourceMappingURL=retry.d.ts.map