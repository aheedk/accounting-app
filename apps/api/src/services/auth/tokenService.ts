import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../../config.js';
import type { UserRole } from '../../db/types.js';

type AccessClaims = {
  user_id: string;
  firm_id: string;
  role: UserRole;
  /** The session (sign-in) this token belongs to, so one session can be ended without the others. */
  sid?: string;
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

// Connecting the firm's Gmail goes through Google and back, so the callback
// cannot see who started it. The start hands Google this short-lived token as
// `state`; the callback takes only a reply carrying one, made for this purpose
// (an access token, which has no `purpose`, is refused).
const GMAIL_CONNECT_PURPOSE = 'gmail_connect';

export type GmailConnectState = { user_id: string; firm_id: string };

export function signGmailConnectState(claims: GmailConnectState): string {
  return jwt.sign({ ...claims, purpose: GMAIL_CONNECT_PURPOSE }, config.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: '10m',
  });
}

/** The firm admin who started the connection, or null for a missing, forged, expired or reused-elsewhere token. */
export function verifyGmailConnectState(token: string | undefined): GmailConnectState | null {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, config.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
    if (typeof decoded === 'string' || decoded['purpose'] !== GMAIL_CONNECT_PURPOSE) return null;
    const { user_id, firm_id } = decoded as Record<string, unknown>;
    return typeof user_id === 'string' && typeof firm_id === 'string' ? { user_id, firm_id } : null;
  } catch {
    return null;
  }
}
