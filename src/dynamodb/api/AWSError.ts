// https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Programming.Errors.html

export default class AWSError extends Error {
  constructor(
    private readonly status: number,
    private readonly type: string,
    message: string,
  ) {
    super(`AWS error ${status}; type: ${type}; message: ${message}`);
  }

  static isType(e: unknown, type: string): boolean {
    return (
      (e instanceof AWSError && e.isType(type)) ||
      (e instanceof Error && e.message === type)
    );
  }

  isType(type: string): boolean {
    return this.type.endsWith(`#${type}`) || this.type === type;
  }

  isTransient(): boolean {
    return (
      this.status >= 500 ||
      this.type.endsWith('#LimitExceededException') ||
      this.type.endsWith('#ProvisionedThroughputExceededException') ||
      this.type.endsWith('#RequestLimitExceeded') ||
      this.type.endsWith('#ThrottlingException')
    );
  }
}
