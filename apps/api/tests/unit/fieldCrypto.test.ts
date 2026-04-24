import { describe, it, expect, beforeEach } from 'vitest';
import { encryptField, decryptField, lastFour } from '../../src/lib/fieldCrypto.js';

describe('fieldCrypto', () => {
  beforeEach(() => {
    process.env['FIELD_ENCRYPTION_KEY'] =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  });

  it('round-trips an SSN through encrypt+decrypt', () => {
    const plain = '123-45-6789';
    const blob = encryptField(plain);
    expect(blob).toBeInstanceOf(Buffer);
    expect(blob.byteLength).toBeGreaterThan(plain.length);
    expect(decryptField(blob)).toBe(plain);
  });

  it('produces a different ciphertext each call (random nonce)', () => {
    const a = encryptField('123-45-6789');
    const b = encryptField('123-45-6789');
    expect(Buffer.compare(a, b)).not.toBe(0);
    expect(decryptField(a)).toBe(decryptField(b));
  });

  it('lastFour returns the last 4 digits ignoring non-digits', () => {
    expect(lastFour('123-45-6789')).toBe('6789');
    expect(lastFour('EIN: 12-3456789')).toBe('6789');
    expect(lastFour('12')).toBe('12');
  });

  it('throws if FIELD_ENCRYPTION_KEY is missing', () => {
    delete process.env['FIELD_ENCRYPTION_KEY'];
    expect(() => encryptField('x')).toThrow(/FIELD_ENCRYPTION_KEY/);
  });
});
