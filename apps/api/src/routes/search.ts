import { Router } from 'express';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { searchRecords, type SearchResult } from '../services/core/searchService.js';
import type { Area } from '@accounting/shared';

const router = Router({ mergeParams: true });
router.use('/businesses/:businessId', requireAuth, resolveBusiness);

const RESULT_AREA: Record<SearchResult['type'], Area | null> = {
  customer: null, vendor: null, invoice: 'sales', estimate: 'sales', bill: 'purchases', check: 'purchases',
};

// The top-bar search: customers, vendors, invoices, estimates, bills and checks of the open company.
router.get('/businesses/:businessId/search', async (req, res, next) => {
  try {
    const query = typeof req.query['q'] === 'string' ? req.query['q'].slice(0, 100) : '';
    const results = await searchRecords(db, { business_id: req.tenancy!.business_id, query });
    // A custom role finds only what it can open: customers and vendors are
    // lookups; documents need their area (docs/specs/2026-11-09-custom-roles-design.md).
    const permissions = req.tenancy!.permissions;
    const shown = permissions
      ? results.filter(result => { const area = RESULT_AREA[result.type]; return !area || permissions[area] !== 'none'; })
      : results;
    res.json({ results: shown });
  } catch (e) { next(e); }
});

export default router;
