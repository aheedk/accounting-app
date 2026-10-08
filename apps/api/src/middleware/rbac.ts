import type { Request, Response, NextFunction } from 'express';
import { AuthError } from '../lib/errors.js';
import { ERR, hasMinRole, type Role } from '@accounting/shared';

// Shown to the user as it is, so it says who can do the thing instead of naming a role code.
const WHO_CAN: Record<Role, string> = {
  firm_admin: 'Only a firm admin can do this.',
  accountant: 'This needs an accountant or a firm admin.',
  staff: 'This needs a staff, accountant or firm admin login. A view-only login cannot change anything.',
  viewer: 'You do not have access to this.',
  client: 'You do not have access to this.',
};

export function requireMinRole(min: Role) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const actual = req.tenancy?.effective_role ?? req.auth?.role;
    if (!actual || !hasMinRole(actual, min)) return next(new AuthError(ERR.FORBIDDEN, WHO_CAN[min], { requires: min }));
    next();
  };
}
