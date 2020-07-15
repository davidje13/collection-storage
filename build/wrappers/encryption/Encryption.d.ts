/// <reference types="node" />
declare type EncT = Buffer;
declare type RawT = Buffer;
export default interface Encryption<KeyT, SerialisedKeyT> {
    encrypt(key: KeyT, v: RawT): Promise<EncT> | EncT;
    decrypt(key: KeyT, v: EncT): Promise<RawT> | RawT;
    generateKey(): Promise<KeyT> | KeyT;
    serialiseKey(key: KeyT): SerialisedKeyT;
    deserialiseKey(data: SerialisedKeyT): KeyT;
}
export {};
//# sourceMappingURL=Encryption.d.ts.map