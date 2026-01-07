export class PromiseTracker {
  /** @internal */ private readonly _inflight = new Set<Promise<any>>();

  do<T>(fn: () => Promise<T>): Promise<T> {
    let flightResolve = (): void => {};
    const flight = new Promise<void>((resolve) => {
      flightResolve = resolve;
    }).then(() => {
      this._inflight.delete(flight);
    });
    this._inflight.add(flight);
    return fn().finally(flightResolve);
  }

  async wait(): Promise<void> {
    const current = [...this._inflight];
    this._inflight.clear();
    await Promise.allSettled(current);
  }
}
