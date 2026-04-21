import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../../config.js';
import type { UserRole } from '../../db/types.js';

type AccessClaims = {
  user_id: string;
  firm_id: string;
  role: UserRole;
};

export function signAccessToken(claims: AccessClaims): string {
  return jwt.sign(claims, config.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: `${config.JWT_ACCESS_TTL_MINUTES}m`,
  });
}

export function verifyAccessToken(token: string): AccessClaims & { iat: number; exp: number } {
  const decoded = jwt.verify(token, config.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
  if (typeof decoded === 'string') throw new Error('unexpected string JWT');
  return decoded as AccessClaims & { iat: number; exp: number };
}

export function generateRefreshToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

// Deterministic so we can look up rows by hash. HMAC with refresh secret.
export async function hashRefreshToken(raw: string): Promise<string> {
  return crypto.createHmac('sha256', config.JWT_REFRESH_SECRET).update(raw).digest('hex');
}
