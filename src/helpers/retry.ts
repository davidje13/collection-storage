function sleep(millis: number): Promise<void> | null {
  return new Promise((resolve): any => setTimeout(resolve, millis));
}

export default (
  shouldRetry: (e: any) => boolean,
  maxAttempts = 5,
  baseDelayMillis = 20,
  attemptDelayMillis = 200,
  randomDelayMillis = 200,
) => async <T>(fn: () => Promise<T> | T): Promise<T> => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await fn();
    } catch (e) {
      if (!shouldRetry(e)) {
        throw e;
      }
      if (attempt >= maxAttempts) {
        e.message += ` (attempted ${attempt} times)`;
        throw e;
      }
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(
      baseDelayMillis +
      attempt * attemptDelayMillis +
      Math.random() * randomDelayMillis,
    );
  }
};
