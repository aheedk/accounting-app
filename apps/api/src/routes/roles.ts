import { Router } from 'express';
import type { Request } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as roleSvc from '../services/admin/roleService.js';
import type { ServiceCtx } from '../lib/ctx.js';

// The firm's own roles, Setup → Roles. Firm admin only, like the users they are given to.
// Spec: docs/specs/2026-11-09-custom-roles-design.md
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

router.use('/me/firm/roles', requireAuth, requireMinRole('firm_admin'));

router.get('/me/firm/roles', async (req, res, next) => {
  try { res.json({ roles: await roleSvc.listRoles(db, req.auth!.firm_id) }); }
  catch (e) { next(e); }
});

router.post('/me/firm/roles', async (req, res, next) => {
  try {
    const body = schemas.customRoleCreateSchema.parse(req.body);
    const role = await db.transaction().execute(trx => roleSvc.createRole(trx, ctxFromReq(req), body));
    res.status(201).json(role);
  } catch (e) { next(e); }
});

router.patch('/me/firm/roles/:id', async (req, res, next) => {
  try {
    const body = schemas.customRoleUpdateSchema.parse(req.body);
    const role = await db.transaction().execute(trx => roleSvc.updateRole(trx, ctxFromReq(req), { id: req.params['id']!, ...body }));
    res.json(role);
  } catch (e) { next(e); }
});

router.delete('/me/firm/roles/:id', async (req, res, next) => {
  try {
    await db.transaction().execute(trx => roleSvc.deleteRole(trx, ctxFromReq(req), { id: req.params['id']! }));
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
