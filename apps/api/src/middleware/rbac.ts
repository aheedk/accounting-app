import type { Request, Response, NextFunction } from 'express';
import { AuthError } from '../lib/errors.js';
import { ERR, hasMinRole, type Role } from '@accounting/shared';

export function requireMinRole(min: Role) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const actual = req.tenancy?.effective_role ?? req.auth?.role;
    if (!actual || !hasMinRole(actual, min)) return next(new AuthError(ERR.FORBIDDEN, `Requires ${min}`));
    next();
  };
}
