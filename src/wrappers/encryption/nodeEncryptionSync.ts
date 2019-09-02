import crypto, { KeyObject } from 'crypto';
import Encryption from './Encryption';

const ALG = 'aes-256-cbc';

const nodeEncryptionSync: Encryption<KeyObject> = {
  encrypt: (key: KeyObject, v: string): string => {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALG, key, iv);
    const part = cipher.update(v, 'utf8', 'base64');
    return `${ALG}:${iv.toString('base64')}:${part}${cipher.final('base64')}`;
  },

  decrypt: (key: KeyObject, v: string): string => {
    const [alg, iv, encrypted] = v.split(':');

    if (alg !== ALG) {
      throw new Error('Unknown algorithm');
    }

    const decipher = crypto.createDecipheriv(
      ALG,
      key as any,
      Buffer.from(iv, 'base64'),
    );
    let decrypted = decipher.update(encrypted, 'base64', 'utf8');
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
