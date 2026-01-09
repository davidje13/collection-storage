export class DuplicateError extends Error {
  constructor(collection: string, attribute?: string) {
    super(attribute ? `duplicate ${collection}.${attribute}` : `duplicate record in ${collection}`);
  }

  get code() {
    return 'DUPLICATE';
  }
}
