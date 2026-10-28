import { Router } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import * as aging from '../services/ar/reports/agingReportService.js';
import * as apAging from '../services/ap/reports/apAgingReportService.js';
import { customerStatement } from '../services/ar/reports/customerStatementService.js';
import { invoicesAndPayments } from '../services/ar/reports/invoicePaymentsService.js';
import { salesByProduct } from '../services/ar/reports/salesByProductService.js';

const router = Router({ mergeParams: true });
router.use('/businesses/:businessId', requireAuth, resolveBusiness);

router.get('/businesses/:businessId/reports/aging', async (req, res, next) => {
  try {
    const q = schemas.agingQuerySchema.parse({ as_of: req.query['as_of'] ?? new Date().toISOString().slice(0, 10) });
    const rows = await aging.customerAging(db, { business_id: req.tenancy!.business_id, as_of: q.as_of });
    res.json({ as_of: q.as_of, rows });
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/reports/ap-aging', async (req, res, next) => {
  try {
    const q = schemas.agingQuerySchema.parse({ as_of: req.query['as_of'] ?? new Date().toISOString().slice(0, 10) });
    const rows = await apAging.vendorAging(db, { business_id: req.tenancy!.business_id, as_of: q.as_of });
    res.json({ as_of: q.as_of, rows });
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/reports/open-invoices', async (req, res, next) => {
  try {
    const q = schemas.agingQuerySchema.parse({ as_of: req.query['as_of'] ?? new Date().toISOString().slice(0, 10) });
    const rows = await aging.openInvoices(db, { business_id: req.tenancy!.business_id, as_of: q.as_of });
    res.json({ as_of: q.as_of, rows });
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/reports/unpaid-bills', async (req, res, next) => {
  try {
    const q = schemas.agingQuerySchema.parse({ as_of: req.query['as_of'] ?? new Date().toISOString().slice(0, 10) });
    const rows = await apAging.unpaidBills(db, { business_id: req.tenancy!.business_id, as_of: q.as_of });
    res.json({ as_of: q.as_of, rows });
  } catch (e) { next(e); }
});

// Invoices and Received Payments: the period's invoices with what was applied to each.
router.get('/businesses/:businessId/reports/invoices-and-payments', async (req, res, next) => {
  try {
    const q = schemas.pnlQuerySchema.parse(req.query);
    const invoices = await invoicesAndPayments(db, { business_id: req.tenancy!.business_id, ...q });
    res.json({ ...q, invoices });
  } catch (e) { next(e); }
});

// Sales by Product/Service: income from invoice lines, dated in the period, under the item each was for.
router.get('/businesses/:businessId/reports/sales-by-product', async (req, res, next) => {
  try {
    const q = schemas.pnlQuerySchema.parse(req.query);
    const rows = await salesByProduct(db, { business_id: req.tenancy!.business_id, ...q });
    res.json({ ...q, rows });
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/reports/customer-statement', async (req, res, next) => {
  try {
    const q = schemas.customerStatementQuerySchema.parse(req.query);
    res.json(await customerStatement(db, { business_id: req.tenancy!.business_id, ...q }));
  } catch (e) { next(e); }
});

export default router;
