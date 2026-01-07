// https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Programming.Errors.html

export class AWSError extends Error {
  /** @internal */ private readonly _status: number;
  /** @internal */ private readonly _type: string;

  constructor(status: number, type: string, message: string) {
    super(`AWS error ${status}; type: ${type}; message: ${message}`);
    this._status = status;
    this._type = type;
  }

  static isType(e: unknown, type: string): boolean {
    return (e instanceof AWSError && e.isType(type)) || (e instanceof Error && e.message === type);
  }

  isType(type: string): boolean {
    return this._type.endsWith(`#${type}`) || this._type === type;
  }

  isTransient(): boolean {
    return (
      this._status >= 500 ||
      this._type.endsWith('#LimitExceededException') ||
      this._type.endsWith('#ProvisionedThroughputExceededException') ||
      this._type.endsWith('#RequestLimitExceeded') ||
      this._type.endsWith('#ThrottlingException')
    );
  }
}
