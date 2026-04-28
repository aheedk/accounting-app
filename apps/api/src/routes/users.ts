import { Router } from 'express';
import type { Request } from 'express';
import { schemas, ERR } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { requireMinRole } from '../middleware/rbac.js';
import { AuthError } from '../lib/errors.js';
import * as userSvc from '../services/admin/userManagementService.js';
import type { ServiceCtx } from '../lib/ctx.js';

const router = Router();

function ctxFromReq(req: Request): ServiceCtx {
  return {
    user_id: req.auth!.user_id,
    firm_id: req.auth!.firm_id,
    business_id: null,
    effective_role: req.auth!.role,
    request_id: req.request_id,
    ip_address: req.ip ?? '0.0.0.0',
    user_agent: req.header('user-agent') ?? '',
  };
}

// Firm-scoped user management. No business resolution — firm_admin only.
router.use('/me/firm/users', requireAuth, requireMinRole('firm_admin'));

router.get('/me/firm/users', async (req, res, next) => {
  try {
    const users = await userSvc.listUsers(db, req.auth!.firm_id);
    res.json({ users });
  } catch (e) { next(e); }
});

router.post('/me/firm/users', async (req, res, next) => {
  try {
    const body = schemas.userCreateSchema.parse(req.body);
    const result = await db.transaction().execute(trx =>
      userSvc.createUser(trx, ctxFromReq(req), {
        firm_id: req.auth!.firm_id,
        email: body.email,
        full_name: body.full_name,
        role: body.role,
      }),
    );
    res.status(201).json(result);
  } catch (e) { next(e); }
});

router.patch('/me/firm/users/:id', async (req, res, next) => {
  try {
    const body = schemas.userRoleUpdateSchema.parse(req.body);
    const user_id = req.params['id']!;
    if (user_id === req.auth!.user_id) {
      throw new AuthError(ERR.FORBIDDEN, 'Cannot change your own role');
    }
    const updated = await db.transaction().execute(trx =>
      userSvc.updateUserRole(trx, ctxFromReq(req), { user_id, role: body.role }),
    );
    res.json(updated);
  } catch (e) { next(e); }
});

router.post('/me/firm/users/:id/business-access', async (req, res, next) => {
  try {
    const body = schemas.businessAccessGrantSchema.parse(req.body);
    const grant = await db.transaction().execute(trx =>
      userSvc.grantBusinessAccess(trx, ctxFromReq(req), {
        user_id: req.params['id']!,
        business_id: body.business_id,
        role_override: body.role_override ?? null,
      }),
    );
    res.status(201).json(grant);
  } catch (e) { next(e); }
});

router.delete('/me/firm/users/:id/business-access/:businessId', async (req, res, next) => {
  try {
    await db.transaction().execute(trx =>
      userSvc.revokeBusinessAccess(trx, ctxFromReq(req), {
        user_id: req.params['id']!,
        business_id: req.params['businessId']!,
      }),
    );
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
