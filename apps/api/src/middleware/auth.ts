import type { Request, Response, NextFunction } from 'express';
import { AuthError } from '../lib/errors.js';
import { ERR } from '@accounting/shared';
import { verifyAccessToken } from '../services/auth/tokenService.js';

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const auth = req.header('authorization');
    if (!auth?.startsWith('Bearer ')) throw new AuthError(ERR.UNAUTHORIZED, 'Missing Bearer token');
    const claims = verifyAccessToken(auth.slice('Bearer '.length));
    req.auth = { user_id: claims.user_id, firm_id: claims.firm_id, role: claims.role };
    next();
  } catch (err) {
    if (err instanceof AuthError) return next(err);
    const reason = err instanceof Error ? err.name : 'unknown';
    if (reason !== 'unknown') console.warn(`[auth] token verify failed: ${reason}`);
    next(new AuthError(ERR.UNAUTHORIZED, 'Invalid or expired token', { reason }));
  }
}
