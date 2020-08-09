function sleep(millis: number): Promise<void> | null {
  return new Promise((resolve): any => setTimeout(resolve, millis));
}

export default (shouldRetry: (e: any) => boolean, {
  timeoutMillis = 60000,
  initialDelayMillis = 20,
  maxDelayMillis = 5000,
  delayGrowth = 2,
  jitter = true,
} = {}) => async <T>(fn: () => Promise<T> | T): Promise<T> => {
  const limit = Date.now() + timeoutMillis;
  let currentDelay = initialDelayMillis;
  for (let attempt = 1; ; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await fn();
    } catch (e) {
      if (!shouldRetry(e)) {
        throw e;
      }

      const delay = (
        Math.min(currentDelay, maxDelayMillis) *
        (jitter ? Math.random() : 1)
      );
      currentDelay *= delayGrowth;

      if (Date.now() + delay > limit) {
        e.message += ` (timeout after ${attempt} attempts)`;
        throw e;
      }

      // eslint-disable-next-line no-await-in-loop
      await sleep(delay);
    }
  }
};
