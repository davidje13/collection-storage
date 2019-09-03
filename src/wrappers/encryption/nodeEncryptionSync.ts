import crypto, { KeyObject } from 'crypto';
import Encryption from './Encryption';

const ALG = 'aes-256-cbc';
const ALG_BUF = Buffer.from(ALG, 'utf8');
const IV_LEN = 16;

const nodeEncryptionSync: Encryption<Buffer, KeyObject> = {
  encrypt: (key: KeyObject, v: string): Buffer => {
    const iv = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv(ALG, key, iv);
    const part = cipher.update(v, 'utf8');
    const final = cipher.final();
    return Buffer.concat([ALG_BUF, iv, part, final]);
  },

  decrypt: (key: KeyObject, v: Buffer): string => {
    if (!v.slice(0, ALG_BUF.length).equals(ALG_BUF)) {
      throw new Error('Unknown encryption algorithm');
    }

    const iv = v.slice(ALG_BUF.length, ALG_BUF.length + IV_LEN);
    const encrypted = v.slice(ALG_BUF.length + IV_LEN);

    const decipher = crypto.createDecipheriv(ALG, key as any, iv);
    let decrypted = decipher.update(encrypted, undefined, 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  },

  generateKey: (): KeyObject => crypto
    .createSecretKey(crypto.randomBytes(32)),

  serialiseKey: (key: KeyObject): string => key.export().toString('base64'),

  deserialiseKey: (data: string): KeyObject => crypto
    .createSecretKey(Buffer.from(data, 'base64')),
};

export default nodeEncryptionSync;
