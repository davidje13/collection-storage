import CollectionStorage from './CollectionStorage';

describe('CollectionStorage.connect', () => {
  it('returns a database object asynchronously', async () => {
    const db = await CollectionStorage.connect('memory://');
    expect(db).not.toEqual(null);
    expect(typeof db.getCollection).toEqual('function');
  });

  it('rejects unknown protocols', async () => {
    const err = await CollectionStorage.connect('foo://bar').catch((e) => e);
    expect(err.message)
      .toEqual('Unsupported database connection string: foo://bar');
  });
});
