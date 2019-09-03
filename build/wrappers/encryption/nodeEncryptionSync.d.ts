/// <reference types="node" />
import { KeyObject } from 'crypto';
import Encryption from './Encryption';
declare const nodeEncryptionSync: Encryption<Buffer, KeyObject>;
export default nodeEncryptionSync;
