import { Router, type Request } from 'express';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import * as fd from '../services/firm/firmDashboardService.js';
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

router.use(requireAuth);

router.get('/firm-overview', async (req, res, next) => {
  try { res.json({ businesses: await fd.getFirmOverview(db, ctxFromReq(req)) }); }
  catch (e) { next(e); }
});

export default router;
