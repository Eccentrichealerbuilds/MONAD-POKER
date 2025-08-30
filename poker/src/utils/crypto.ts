import { PrivyError } from '../types/errors';

export interface ExportKeyResponse {
  encryption_type: 'HPKE';
  ciphertext: string;
  encapsulated_key: string;
}

export interface EncryptedKeyData {
  privateKey: CryptoKey;
  exportedPrivateKey: string;
}

export class CryptoUtils {
  private static instance: CryptoUtils;
  private constructor() {}

  static getInstance(): CryptoUtils {
    if (!this.instance) {
      this.instance = new CryptoUtils();
    }
    return this.instance;
  }

  async generateKeyPair(): Promise<{publicKey: CryptoKey; privateKey: CryptoKey}> {
    try {
      const keyPair = await window.crypto.subtle.generateKey(
        {
          name: 'ECDH',
          namedCurve: 'P-256'
        },
        true,
        ['deriveBits']
      );
      return keyPair;
    } catch (error) {
      throw new PrivyError('Failed to generate key pair', 'CRYPTO_ERROR', error);
    }
  }

  async exportPublicKeyAsDER(publicKey: CryptoKey): Promise<string> {
    try {
      const exported = await window.crypto.subtle.exportKey('spki', publicKey);
      return this.arrayBufferToBase64(exported);
    } catch (error) {
      throw new PrivyError('Failed to export public key', 'CRYPTO_ERROR', error);
    }
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  async deriveSharedSecret(privateKey: CryptoKey, encapsulatedKey: string): Promise<ArrayBuffer> {
    try {
      const encapsulatedKeyBuffer = this.base64ToArrayBuffer(encapsulatedKey);
      const importedEncapsulatedKey = await window.crypto.subtle.importKey(
        'spki',
        encapsulatedKeyBuffer,
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        []
      );

      return await window.crypto.subtle.deriveBits(
        {
          name: 'ECDH',
          public: importedEncapsulatedKey
        },
        privateKey,
        256
      );
    } catch (error) {
      throw new PrivyError('Failed to derive shared secret', 'CRYPTO_ERROR', error);
    }
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }
}
