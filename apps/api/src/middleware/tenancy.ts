import type { Request, Response, NextFunction } from 'express';
import { db } from '../db/index.js';
import { AuthError, NotFoundError } from '../lib/errors.js';
import { ERR, type Role } from '@accounting/shared';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      tenancy?: { business_id: string; effective_role: Role };
    }
  }
}

// Mount on routes that take `:businessId` path param.
export async function resolveBusiness(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new AuthError(ERR.UNAUTHORIZED, 'Not authenticated');
    const business_id = req.params['businessId'];
    if (!business_id) throw new NotFoundError('business');

    const business = await db.selectFrom('businesses')
      .select(['id', 'firm_id'])
      .where('id', '=', business_id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!business || business.firm_id !== req.auth.firm_id) throw new NotFoundError('business', business_id);

    const uba = await db.selectFrom('user_business_access')
      .select(['role_override'])
      .where('user_id', '=', req.auth.user_id)
      .where('business_id', '=', business_id)
      .executeTakeFirst();
    if (!uba && req.auth.role !== 'firm_admin') throw new AuthError(ERR.FORBIDDEN, 'No access to this business');

    const effective_role = (uba?.role_override ?? req.auth.role) as Role;
    req.tenancy = { business_id, effective_role };
    next();
  } catch (err) { next(err); }
}
