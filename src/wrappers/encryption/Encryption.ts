export default interface Encryption<EncT, KeyT, SerialisedKeyT> {
  encrypt(key: KeyT, v: Buffer): Promise<EncT> | EncT;

  decrypt(key: KeyT, v: EncT): Promise<Buffer> | Buffer;

  generateKey(): Promise<KeyT> | KeyT;

  serialiseKey(key: KeyT): SerialisedKeyT;

  deserialiseKey(data: SerialisedKeyT): KeyT;
}
