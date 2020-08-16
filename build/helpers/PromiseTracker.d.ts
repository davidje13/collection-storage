export default class PromiseTracker {
    private readonly inflight;
    do<T>(fn: () => Promise<T>): Promise<T>;
    wait(): Promise<void>;
}
//# sourceMappingURL=PromiseTracker.d.ts.map