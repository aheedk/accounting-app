import { Router } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as activity from '../services/audit/activityLogService.js';

const router = Router({ mergeParams: true });

router.use('/businesses/:businessId', requireAuth, resolveBusiness);

// Who did what in this company. For an accountant and up: the log shows every
// record before and after each change, payroll included.
router.get('/businesses/:businessId/activity-log', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const q = schemas.activityLogQuerySchema.parse(req.query);
    const scope = { firm_id: req.auth!.firm_id, business_id: req.tenancy!.business_id };
    const [page, facets] = await Promise.all([
      activity.listActivity(db, { ...scope, ...q }),
      // Only with the first page; the choices do not change while paging.
      q.before ? null : activity.activityFacets(db, scope),
    ]);
    res.json({ ...page, ...(facets ? { facets } : {}) });
  } catch (e) { next(e); }
});

// What belongs to no company: sign-ins, and changes to the firm's users.
router.get('/me/firm/activity-log', requireAuth, requireMinRole('firm_admin'), async (req, res, next) => {
  try {
    const q = schemas.activityLogQuerySchema.parse(req.query);
    const scope = { firm_id: req.auth!.firm_id, business_id: null };
    const [page, facets] = await Promise.all([
      activity.listActivity(db, { ...scope, ...q }),
      q.before ? null : activity.activityFacets(db, scope),
    ]);
    res.json({ ...page, ...(facets ? { facets } : {}) });
  } catch (e) { next(e); }
});

export default router;
