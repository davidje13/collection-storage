export default interface Encryption<EncT, KeyT, SerialisedKeyT> {
  encrypt(key: KeyT, v: string): Promise<EncT> | EncT;

  decrypt(key: KeyT, v: EncT): Promise<string> | string;

  generateKey(): Promise<KeyT> | KeyT;

  serialiseKey(key: KeyT): SerialisedKeyT;

  deserialiseKey(data: SerialisedKeyT): KeyT;
}
