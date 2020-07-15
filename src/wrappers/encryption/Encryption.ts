type EncT = Buffer;
type RawT = Buffer;

export default interface Encryption<KeyT, SerialisedKeyT> {
  encrypt(key: KeyT, v: RawT): Promise<EncT> | EncT;

  decrypt(key: KeyT, v: EncT): Promise<RawT> | RawT;

  generateKey(): Promise<KeyT> | KeyT;

  serialiseKey(key: KeyT): SerialisedKeyT;

  deserialiseKey(data: SerialisedKeyT): KeyT;
}
