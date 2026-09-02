import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import { createDraft as createDraftBill, postBill } from '../services/ap/billService.js';
import { createDraft as createDraftInvoice, postInvoice } from '../services/ar/invoiceService.js';
import type { ServiceCtx } from '../lib/ctx.js';
import type { Request } from 'express';

const router = Router();

router.use('/businesses/:businessId', requireAuth, resolveBusiness);

function ctx(req: Request): ServiceCtx {
  return {
    user_id: req.auth!.user_id,
    firm_id: req.auth!.firm_id,
    business_id: req.tenancy!.business_id,
    effective_role: req.tenancy!.effective_role,
    request_id: req.request_id,
    ip_address: req.ip ?? '0.0.0.0',
    user_agent: req.header('user-agent') ?? '',
  };
}

function safeJson<T>(val: unknown): T {
  return (typeof val === 'string' ? JSON.parse(val) : val) as T;
}

function toIsoDate(mmddyyyy: string): string {
  const [m, d, y] = mmddyyyy.split('/');
  if (!y) return new Date().toISOString().slice(0, 10);
  return `${y}-${(m ?? '01').padStart(2, '0')}-${(d ?? '01').padStart(2, '0')}`;
}

// List invoice imports — ?history=1 returns approved+rejected, default returns pending
router.get('/businesses/:businessId/invoice-imports', async (req, res, next) => {
  try {
    const history = req.query['history'] === '1';
    const typeFilter = req.query['type'] as string | undefined;
    let q = db
      .selectFrom('invoice_import_staging')
      .selectAll()
      .orderBy('received_at', 'desc');
    q = history
      ? q.where('status', 'in', ['approved', 'rejected']).limit(100)
      : q.where('status', '=', 'pending');

    const rows = await q.execute();
    res.json({
      imports: rows
        .filter(r => !typeFilter || r.invoice_type === typeFilter)
        .map(r => ({
          ...r,
          line_items: safeJson(r.line_items),
        })),
    });
  } catch (e) { next(e); }
});

type LineItem = {
  description: string;
  quantity: string;
  unit_price: string;
  amount: string;
  suggested_account?: string;
};

const approveSchema = z.object({
  vendor_id: z.string().uuid().optional(),   // required for AP
  customer_id: z.string().uuid().optional(), // required for AR
  line_items: z.array(z.object({
    index: z.number().int().min(0),
    account_id: z.string().uuid(),
    include: z.boolean().default(true),
  })),
  include_tax: z.boolean().default(false),
  tax_account_id: z.string().uuid().optional(),
});

// Approve: create Bill (AP) or Invoice (AR)
router.post(
  '/businesses/:businessId/invoice-imports/:importId/approve',
  requireMinRole('accountant'),
  async (req, res, next) => {
    try {
      const body = approveSchema.parse(req.body);
      const bizId = req.tenancy!.business_id;
      const serviceCtx = ctx(req);

      const staged = await db
        .selectFrom('invoice_import_staging')
        .selectAll()
        .where('id', '=', req.params['importId']!)
        .where('status', '=', 'pending')
        .executeTakeFirst();

      if (!staged) { res.status(404).json({ error: 'Import not found or already processed' }); return; }

      const lineItems: LineItem[] = safeJson(staged.line_items);
      const included = body.line_items.filter(l => l.include);
      const entryDate = staged.invoice_date ? toIsoDate(staged.invoice_date) : new Date().toISOString().slice(0, 10);
      const dueDate = staged.due_date ? toIsoDate(staged.due_date) : entryDate;
      const isAp = staged.invoice_type === 'ap';

      await db.transaction().execute(async trx => {
        const hasTax = body.include_tax && body.tax_account_id && staged.tax_amount && parseFloat(staged.tax_amount) > 0;

        const importIdSuffix = staged.id.slice(0, 6);

        // If the bill/invoice number already exists, append a short unique suffix
        async function resolveBillNumber(base: string): Promise<string> {
          const dup = await trx.selectFrom('bills').select('id')
            .where('business_id', '=', bizId).where('bill_number', '=', base).executeTakeFirst();
          return dup ? `${base}-${importIdSuffix}` : base;
        }
        async function resolveInvoiceNumber(base: string): Promise<string> {
          const dup = await trx.selectFrom('invoices').select('id')
            .where('business_id', '=', bizId).where('invoice_number', '=', base).executeTakeFirst();
          return dup ? `${base}-${importIdSuffix}` : base;
        }

        if (isAp) {
          if (!body.vendor_id) throw new Error('vendor_id required for AP invoices');
          const billLines = included.map(item => {
            const li = lineItems[item.index];
            return {
              description: li?.description ?? '',
              quantity: li?.quantity && parseFloat(li.quantity) > 0 ? li.quantity : '1',
              unit_price: li?.unit_price && parseFloat(li.unit_price) > 0 ? li.unit_price : (li?.amount ?? '0'),
              expense_account_id: item.account_id,
            };
          });
          if (hasTax) {
            billLines.push({
              description: 'Sales Tax',
              quantity: '1',
              unit_price: staged.tax_amount!,
              expense_account_id: body.tax_account_id!,
            });
          }
          const billNumber = await resolveBillNumber(staged.invoice_number ?? `IMP-${staged.id.slice(0, 8)}`);
          const { bill } = await createDraftBill(trx, serviceCtx, {
            business_id: bizId,
            vendor_id: body.vendor_id,
            bill_number: billNumber,
            bill_date: entryDate,
            due_date: dueDate,
            memo: staged.vendor_customer ?? null,
            terms: null,
            lines: billLines,
          });
          await postBill(trx, serviceCtx, { bill_id: bill.id });
        } else {
          if (!body.customer_id) throw new Error('customer_id required for AR invoices');
          const invLines = included.map(item => {
            const li = lineItems[item.index];
            return {
              description: li?.description ?? '',
              quantity: li?.quantity && parseFloat(li.quantity) > 0 ? li.quantity : '1',
              unit_price: li?.unit_price && parseFloat(li.unit_price) > 0 ? li.unit_price : (li?.amount ?? '0'),
              revenue_account_id: item.account_id,
              tax_code_id: null,
            };
          });
          if (hasTax) {
            invLines.push({
              description: 'Sales Tax',
              quantity: '1',
              unit_price: staged.tax_amount!,
              revenue_account_id: body.tax_account_id!,
              tax_code_id: null,
            });
          }
          const invoiceNumber = await resolveInvoiceNumber(staged.invoice_number ?? `IMP-${staged.id.slice(0, 8)}`);
          const { invoice } = await createDraftInvoice(trx, serviceCtx, {
            business_id: bizId,
            customer_id: body.customer_id,
            invoice_number: invoiceNumber,
            issue_date: entryDate,
            due_date: dueDate,
            memo: staged.vendor_customer ?? null,
            terms: null,
            lines: invLines,
          });
          await postInvoice(trx, serviceCtx, { invoice_id: invoice.id });
        }

        await trx
          .updateTable('invoice_import_staging')
          .set({
            status: 'approved',
            business_id: bizId,
            approved_by_user_id: serviceCtx.user_id,
            approved_at: new Date().toISOString(),
          })
          .where('id', '=', staged.id)
          .execute();
      });

      res.json({ ok: true });
    } catch (e) { next(e); }
  },
);

// Reject
router.post(
  '/businesses/:businessId/invoice-imports/:importId/reject',
  requireMinRole('accountant'),
  async (req, res, next) => {
    try {
      const result = await db
        .updateTable('invoice_import_staging')
        .set({ status: 'rejected', business_id: req.tenancy!.business_id })
        .where('id', '=', req.params['importId']!)
        .where('status', '=', 'pending')
        .executeTakeFirst();
      if (!result.numUpdatedRows) { res.status(404).json({ error: 'Import not found or already processed' }); return; }
      res.json({ ok: true });
    } catch (e) { next(e); }
  },
);

export default router;
