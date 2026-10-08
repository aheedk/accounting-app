import { describe, it, expect } from 'vitest';
import { base32Decode, base32Encode, generateTotpSecret, otpauthUri, totpCode, verifyTotp } from '../../src/services/auth/totp.js';

// The secret every authenticator-app standard test uses: the ASCII text "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('totp', () => {
  it('gives the codes the standard gives (RFC 6238, the last 6 digits)', () => {
    expect(totpCode(RFC_SECRET, 59_000)).toBe('287082');
    expect(totpCode(RFC_SECRET, 1_111_111_109_000)).toBe('081804');
    expect(totpCode(RFC_SECRET, 1_234_567_890_000)).toBe('005924');
    expect(totpCode(RFC_SECRET, 20_000_000_000_000)).toBe('353130');
  });

  it('round-trips base32', () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 17]);
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
  });

  it('accepts the code for now and for one step either side, and nothing further', () => {
    const now = 1_700_000_000_000;
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, now), now)).toBe(true);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, now - 30_000), now)).toBe(true);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, now + 30_000), now)).toBe(true);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, now - 90_000), now)).toBe(false);
    expect(verifyTotp(RFC_SECRET, '12345', now)).toBe(false);
    expect(verifyTotp(RFC_SECRET, 'abcdef', now)).toBe(false);
  });

  it('makes a secret an app can take, and the link that carries it', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    const uri = otpauthUri({ secret, account: 'pat@firm.com', issuer: 'Accounting' });
    expect(uri).toContain('otpauth://totp/Accounting%3Apat%40firm.com?');
    expect(uri).toContain(`secret=${secret}`);
  });
});
