import type { Request, Response, NextFunction } from 'express';
import { db } from '../db/index.js';
import { AuthError, NotFoundError } from '../lib/errors.js';
import { ERR, normalizePermissions, refusalMessage, roleForRequest, type Permissions, type Role } from '@accounting/shared';
import { clientMayRequest } from '../lib/clientAccess.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      tenancy?: {
        business_id: string;
        /** For a custom role, the built-in role of its level in this request's area. */
        effective_role: Role;
        /** Set when the login acts here under one of the firm's own roles. */
        permissions?: Permissions;
      };
    }
  }
}

// Mount on routes that take `:businessId` path param.
export async function resolveBusiness(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new AuthError(ERR.UNAUTHORIZED, 'Not authenticated');
    const business_id = req.params['businessId'];
    if (!business_id) throw new NotFoundError('business');
    // Every router mounts its own `router.use('/businesses/:businessId', ..., resolveBusiness)`
    // (50 of them) — Express path-prefix matching means ALL of them fire on a
    // request to e.g. /businesses/x/bank-deposits, not just the one that ends
    // up handling it, each paying 2 DB round trips. :businessId is the same
    // path segment throughout a single request, so once resolved, skip re-
    // resolving on every subsequent router in the chain.
    if (req.tenancy?.business_id === business_id) return next();

    const business = await db.selectFrom('businesses')
      .select(['id', 'firm_id'])
      .where('id', '=', business_id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!business || business.firm_id !== req.auth.firm_id) throw new NotFoundError('business', business_id);

    // The grant for this company and both kinds of role: one for this company
    // (built-in or the firm's own), else the login's own (the firm's own, or the
    // built-in one the access token carries).
    const access = await db.selectFrom('users as u')
      .leftJoin('user_business_access as uba', join => join
        .onRef('uba.user_id', '=', 'u.id').on('uba.business_id', '=', business_id))
      .leftJoin('firm_roles as company_role', join => join
        .onRef('company_role.id', '=', 'uba.custom_role_id').on('company_role.firm_id', '=', req.auth!.firm_id))
      .leftJoin('firm_roles as own_role', join => join
        .onRef('own_role.id', '=', 'u.custom_role_id').on('own_role.firm_id', '=', req.auth!.firm_id))
      .select([
        'uba.id as grant_id', 'uba.role_override',
        'company_role.permissions as company_permissions', 'company_role.id as company_role_id',
        'own_role.permissions as own_permissions', 'own_role.id as own_role_id',
      ])
      .where('u.id', '=', req.auth.user_id)
      .executeTakeFirst();
    if (!access?.grant_id && req.auth.role !== 'firm_admin') throw new AuthError(ERR.FORBIDDEN, 'No access to this business');

    let effective_role = (access?.role_override ?? req.auth.role) as Role;
    let permissions: Permissions | undefined;
    if (access?.company_role_id) permissions = normalizePermissions(access.company_permissions);
    else if (!access?.role_override && access?.own_role_id) permissions = normalizePermissions(access.own_permissions);
    if (permissions) {
      // Docs: docs/specs/2026-11-09-custom-roles-design.md. The route's own guard
      // then checks the built-in role of the level in this request's area.
      const decided = roleForRequest(permissions, req.method, req.path);
      if ('unmapped' in decided) throw new AuthError(ERR.FORBIDDEN, 'Your role has no access to this.');
      if ('refused' in decided) throw new AuthError(ERR.FORBIDDEN, refusalMessage(decided.refused));
      effective_role = decided.role;
    }
    // Checked here, once, because every business route passes through this
    // middleware before its own handler. `req.path` is what follows the business id.
    if (effective_role === 'client' && !clientMayRequest(req.method, req.path)) {
      throw new AuthError(ERR.FORBIDDEN, 'A client login can view reports and invoices only.');
    }
    req.tenancy = { business_id, effective_role, ...(permissions ? { permissions } : {}) };
    next();
  } catch (err) { next(err); }
}
