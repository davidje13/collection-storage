import crypto, { KeyObject } from 'crypto';
import type Encryption from './Encryption';

const ALG = 'aes-256-cbc';
const ALG_BUF = Buffer.from(`${ALG}:`, 'utf8');
const IV_LEN = 16;

const nodeEncryptionSync: Encryption<KeyObject, Buffer> = {
  encrypt: (key: KeyObject, v: Buffer): Buffer => {
    const iv = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv(ALG, key, iv);
    const part = cipher.update(v);
    const final = cipher.final();
    return Buffer.concat([ALG_BUF, iv, part, final]);
  },

  decrypt: (key: KeyObject, v: Buffer): Buffer => {
    if (!v.slice(0, ALG_BUF.length).equals(ALG_BUF)) {
      throw new Error('Unknown encryption algorithm');
    }

    const iv = v.slice(ALG_BUF.length, ALG_BUF.length + IV_LEN);
    const encrypted = v.slice(ALG_BUF.length + IV_LEN);

    const decipher = crypto.createDecipheriv(ALG, key, iv);
    const part = decipher.update(encrypted);
    const final = decipher.final();

    return Buffer.concat([part, final]);
  },

  generateKey: (): KeyObject => crypto
    .createSecretKey(crypto.randomBytes(32)),

  serialiseKey: (key: KeyObject): Buffer => key.export(),

  deserialiseKey: (data: Buffer): KeyObject => crypto.createSecretKey(data),
};

export default nodeEncryptionSync;
