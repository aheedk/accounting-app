import type { Request, Response, NextFunction } from 'express';
import { ERR } from '@accounting/shared';
import { db } from '../db/index.js';
import { AuthError } from '../lib/errors.js';

/** Everything under these is payroll: employees, pay runs, what is owed in payroll tax, and compliance. */
export const PAYROLL_PATHS = [
  '/businesses/:businessId/employees',
  '/businesses/:businessId/pay-runs',
  '/businesses/:businessId/payroll-overview',
  '/businesses/:businessId/payroll-tax-liabilities',
  '/businesses/:businessId/compliance-items',
];

/**
 * Payroll is for the logins a firm admin has left it on for. A firm admin
 * always has it. Mounted once in app.ts in front of the payroll routers, so a
 * payroll route added to one of them later is covered without thinking of it.
 *
 * Pay that has been run is also in the ledger as journal entries, which this
 * does not hide: it closes the payroll screens, not the general ledger.
 */
export async function requirePayrollAccess(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new AuthError(ERR.UNAUTHORIZED, 'Not authenticated');
    if (req.auth.role === 'firm_admin') return next();
    const user = await db.selectFrom('users').select('payroll_access')
      .where('id', '=', req.auth.user_id).executeTakeFirst();
    if (!user?.payroll_access) {
      throw new AuthError(ERR.FORBIDDEN, 'Payroll is not part of your access. A firm admin can turn it on.');
    }
    next();
  } catch (err) { next(err); }
}
