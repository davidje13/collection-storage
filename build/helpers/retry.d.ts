declare const _default: (shouldRetry: (e: any) => boolean, { timeoutMillis, initialDelayMillis, maxDelayMillis, delayGrowth, jitter, }?: {
    timeoutMillis?: number;
    initialDelayMillis?: number;
    maxDelayMillis?: number;
    delayGrowth?: number;
    jitter?: boolean;
}) => <T>(fn: () => T | Promise<T>) => Promise<T>;
export default _default;
//# sourceMappingURL=retry.d.ts.map