export default interface Encryption<Key> {
    encrypt(key: Key, v: string): Promise<string> | string;
    decrypt(key: Key, v: string): Promise<string> | string;
    generateKey(): Promise<Key> | Key;
    serialiseKey(key: Key): string;
    deserialiseKey(data: string): Key;
}
