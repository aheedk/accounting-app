import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { randomBytes } from 'node:crypto';

const NONCE_BYTES = 24;

function getKey(): Uint8Array {
  const hex = process.env['FIELD_ENCRYPTION_KEY'];
  if (!hex || hex.length !== 64) {
    throw new Error('FIELD_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)');
  }
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

export function encryptField(plaintext: string): Buffer {
  const key = getKey();
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = xchacha20poly1305(key, nonce);
  const ct = cipher.encrypt(new TextEncoder().encode(plaintext));
  return Buffer.concat([nonce, Buffer.from(ct)]);
}

export function decryptField(blob: Buffer): string {
  const key = getKey();
  const nonce = blob.subarray(0, NONCE_BYTES);
  const ct = blob.subarray(NONCE_BYTES);
  const cipher = xchacha20poly1305(key, nonce);
  const pt = cipher.decrypt(ct);
  return new TextDecoder().decode(pt);
}

export function lastFour(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.slice(-4);
}
