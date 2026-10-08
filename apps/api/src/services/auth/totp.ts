import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// The second step of signing in: a 6-digit code from an authenticator app.
// This is the standard every such app follows (RFC 6238 on top of RFC 4226):
// HMAC-SHA1 of a 30-second counter, keyed by a secret both sides hold.
// Written out here because it is forty lines and the app adds no dependency for it.

const STEP_SECONDS = 30;
const DIGITS = 6;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Base32, the form authenticator apps take a secret in. */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    value = (value << 5) | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new secret: 20 random bytes, as base32. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The code for the 30-second step containing `atMs`. */
export function totpCode(secret: string, atMs: number = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 1000 / STEP_SECONDS)));
  const digest = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = ((digest[offset]! & 0x7f) << 24) | (digest[offset + 1]! << 16) | (digest[offset + 2]! << 8) | digest[offset + 3]!;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * Whether `code` is right now, give or take one step either way, which allows
 * for a phone whose clock is a little off and for the seconds spent typing.
 */
export function verifyTotp(secret: string, code: string, atMs: number = Date.now()): boolean {
  const given = Buffer.from(code.replace(/\s/g, ''));
  if (given.length !== DIGITS) return false;
  return [-1, 0, 1].some(step => {
    const expected = Buffer.from(totpCode(secret, atMs + step * STEP_SECONDS * 1000));
    return timingSafeEqual(given, expected);
  });
}

/** What an authenticator app reads to add the account (as a link or a QR code). */
export function otpauthUri(input: { secret: string; account: string; issuer: string }): string {
  const label = encodeURIComponent(`${input.issuer}:${input.account}`);
  const params = new URLSearchParams({ secret: input.secret, issuer: input.issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}
