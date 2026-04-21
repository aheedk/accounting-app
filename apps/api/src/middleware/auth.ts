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
    if (err instanceof AuthError) next(err);
    else next(new AuthError(ERR.TOKEN_EXPIRED, 'Invalid or expired token'));
  }
}
