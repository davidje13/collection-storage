import { CollectionStorage } from './CollectionStorage.mts';
import { MemoryDB } from './memory/MemoryDB.mts';
import 'lean-test';

describe('CollectionStorage.connect', () => {
  it('returns a database object asynchronously', { timeout: 5000 }, async () => {
    CollectionStorage.register(['memory'], MemoryDB.connect);
    const db = await CollectionStorage.connect('memory://');
    expect(db).toBeInstanceOf(MemoryDB);
  });

  it('rejects unknown protocols', { timeout: 5000 }, async () => {
    const err = await CollectionStorage.connect('foo://bar').catch((e) => e);
    expect(err.message).toEqual('Unsupported database connection string: foo://bar');
  });

  it('invokes dynamic loaders if no registered protocol matches', { timeout: 5000 }, async () => {
    CollectionStorage.dynamic([
      ['foo', async () => CollectionStorage.register(['foo'], MemoryDB.connect)],
    ]);
    const db = await CollectionStorage.connect('foo://');
    expect(db).toBeInstanceOf(MemoryDB);
  });
});
