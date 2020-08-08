export default class DDBError extends Error {
  static ConditionalCheckFailedException = 'ConditionalCheckFailedException';

  static ResourceInUseException = 'ResourceInUseException';

  static ResourceNotFoundException = 'ResourceNotFoundException';

  constructor(
    status: number,
    private readonly type: string,
    message: string,
  ) {
    super(`DynamoDB error ${status}; type: ${type}; message: ${message}`);
  }

  isType(type: string): boolean {
    return this.type.endsWith(`#${type}`) || this.type === type;
  }
}
