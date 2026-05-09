import { Router } from 'express';
import type { Request } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as inv from '../services/ar/invoiceService.js';
import type { ServiceCtx } from '../lib/ctx.js';

const router = Router({ mergeParams: true });
function ctxFromReq(req: Request): ServiceCtx {
  return {
    user_id: req.auth!.user_id, firm_id: req.auth!.firm_id,
    business_id: req.tenancy!.business_id, effective_role: req.tenancy!.effective_role,
    request_id: req.request_id, ip_address: req.ip ?? '0.0.0.0',
    user_agent: req.header('user-agent') ?? '',
  };
}
router.use('/businesses/:businessId', requireAuth, resolveBusiness);

router.get('/businesses/:businessId/invoices', async (req, res, next) => {
  try {
    const q: { business_id: string; status?: string; customer_id?: string } = {
      business_id: req.tenancy!.business_id,
    };
    const status = req.query['status'];
    if (typeof status === 'string') q.status = status;
    const customer_id = req.query['customer_id'];
    if (typeof customer_id === 'string') q.customer_id = customer_id;
    const list = await inv.listInvoices(db, q);
    res.json({ invoices: list });
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/invoices/next-number', async (req, res, next) => {
  try {
    const next_number = await inv.getNextInvoiceNumber(db, req.tenancy!.business_id);
    res.json({ next_number });
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/invoices/:id', async (req, res, next) => {
  try { res.json(await inv.getInvoiceWithLines(db, req.tenancy!.business_id, req.params['id']!)); }
  catch (e) { next(e); }
});

router.post('/businesses/:businessId/invoices', requireMinRole('staff'), async (req, res, next) => {
  try {
    const body = schemas.invoiceDraftCreateSchema.parse(req.body);
    const created = await db.transaction().execute(trx =>
      inv.createDraft(trx, ctxFromReq(req), {
        business_id: req.tenancy!.business_id,
        customer_id: body.customer_id,
        invoice_number: body.invoice_number,
        issue_date: body.issue_date,
        due_date: body.due_date,
        memo: body.memo ?? null,
        terms: body.terms ?? null,
        lines: body.lines.map(l => ({
          description: l.description,
          quantity: l.quantity,
          unit_price: l.unit_price,
          revenue_account_id: l.revenue_account_id,
          tax_code_id: l.tax_code_id ?? null,
        })),
      }),
    );
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/invoices/:id/post', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const posted = await db.transaction().execute(trx => inv.postInvoice(trx, ctxFromReq(req), { invoice_id: req.params['id']! }));
    res.json(posted);
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/invoices/:id/void', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = schemas.invoiceVoidSchema.parse(req.body);
    const voided = await db.transaction().execute(trx => inv.voidInvoice(trx, ctxFromReq(req), { invoice_id: req.params['id']!, void_reason: body.void_reason }));
    res.json(voided);
  } catch (e) { next(e); }
});

export default router;
