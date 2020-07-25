export default class PromiseTracker {
  private readonly inflight = new Set<Promise<any>>();

  do<T>(fn: () => Promise<T>): Promise<T> {
    let flightResolve = (): void => {};
    const flight = new Promise((resolve) => {
      flightResolve = resolve;
    }).then(() => {
      this.inflight.delete(flight);
    });
    this.inflight.add(flight);
    return fn().finally(flightResolve);
  }

  async wait(): Promise<void> {
    const current = [...this.inflight];
    this.inflight.clear();
    await Promise.allSettled(current);
  }
}
