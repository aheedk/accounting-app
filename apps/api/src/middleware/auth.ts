import type { Request, Response, NextFunction } from 'express';
import { AuthError } from '../lib/errors.js';
import { ERR } from '@accounting/shared';
import { verifyAccessToken } from '../services/auth/tokenService.js';
import { accessTokenRevoked } from '../services/auth/sessionRevocation.js';

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  // Every router mounts its own `router.use('/businesses/:businessId', requireAuth, ...)`
  // (50 of them) — Express path-prefix matching means ALL of them fire on a
  // request to e.g. /businesses/x/bank-deposits, not just the one that ends up
  // handling it. The JWT doesn't change mid-request, so once verified, skip
  // re-verifying on every subsequent router in the chain.
  if (req.auth) return next();
  try {
    const auth = req.header('authorization');
    if (!auth?.startsWith('Bearer ')) throw new AuthError(ERR.UNAUTHORIZED, 'Missing Bearer token');
    const claims = verifyAccessToken(auth.slice('Bearer '.length));
    // The session was signed out or ended, or the login was switched off, since this token was issued.
    if (accessTokenRevoked(claims.user_id, claims.iat, claims.sid)) throw new AuthError(ERR.UNAUTHORIZED, 'This session has ended');
    req.auth = { user_id: claims.user_id, firm_id: claims.firm_id, role: claims.role };
    next();
  } catch (err) {
    if (err instanceof AuthError) return next(err);
    const reason = err instanceof Error ? err.name : 'unknown';
    if (reason !== 'unknown') console.warn(`[auth] token verify failed: ${reason}`);
    next(new AuthError(ERR.UNAUTHORIZED, 'Invalid or expired token', { reason }));
  }
}
