declare const _default: (shouldRetry: (e: any) => boolean, maxAttempts?: number, baseDelayMillis?: number, attemptDelayMillis?: number, randomDelayMillis?: number) => <T>(fn: () => T | Promise<T>) => Promise<T>;
export default _default;
