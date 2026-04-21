import { describe, it, expect, vi } from 'vitest';
import {
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashRefreshToken,
} from '../../src/services/auth/tokenService.js';

describe('tokenService', () => {
  const sample = {
    user_id: '11111111-1111-1111-1111-111111111111',
    firm_id: '22222222-2222-2222-2222-222222222222',
    role: 'accountant' as const,
  };

  it('signs and verifies access token', () => {
    const tok = signAccessToken(sample);
    const claims = verifyAccessToken(tok);
    expect(claims.user_id).toBe(sample.user_id);
    expect(claims.firm_id).toBe(sample.firm_id);
    expect(claims.role).toBe('accountant');
  });

  it('rejects tampered access token', () => {
    const tok = signAccessToken(sample);
    const tampered = tok.slice(0, -2) + 'XX';
    expect(() => verifyAccessToken(tampered)).toThrow();
  });

  it('generates refresh token of sufficient entropy', () => {
    const t1 = generateRefreshToken();
    const t2 = generateRefreshToken();
    expect(t1).not.toBe(t2);
    expect(t1.length).toBeGreaterThanOrEqual(43); // base64 of 32 bytes
  });

  it('hashes refresh token deterministically for lookup', async () => {
    const raw = generateRefreshToken();
    const h1 = await hashRefreshToken(raw);
    const h2 = await hashRefreshToken(raw);
    expect(h1).toBe(h2);
    expect(h1).not.toBe(raw);
  });
});
