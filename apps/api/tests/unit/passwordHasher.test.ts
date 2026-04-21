import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/services/auth/passwordHasher.js';

describe('passwordHasher', () => {
  it('produces a hash that verifies', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    expect(hash).not.toBe('correct-horse-battery-staple');
    expect(await verifyPassword('correct-horse-battery-staple', hash)).toBe(true);
  });

  it('rejects wrong password', async () => {
    const hash = await hashPassword('secret123');
    expect(await verifyPassword('not-it', hash)).toBe(false);
  });
});
