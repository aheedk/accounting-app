import { Router } from 'express';
import { z } from 'zod';
import { suggestInvoiceLines, rememberInvoiceLineCoding } from '../services/ai/invoiceCodingService.js';
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
    const bizId = req.tenancy!.business_id;
    const baseQ = db
      .selectFrom('invoice_import_staging')
      .select(['id', 'business_id', 'gmail_message_id', 'email_from', 'email_subject',
               'received_at', 'invoice_type', 'vendor_customer', 'invoice_number',
               'invoice_date', 'due_date', 'line_items', 'subtotal', 'tax_amount',
               'total', 'status', 'addressed_to', 'rejection_reason',
               'approved_by_user_id', 'approved_at', 'created_at'])
      .orderBy('received_at', 'desc');
    const q = history
      ? baseQ.where(eb => eb.or([
          eb('business_id', '=', bizId),
          eb.and([eb('business_id', 'is', null), eb('status', '=', 'rejected')]),
        ])).where('status', 'in', ['approved', 'rejected']).limit(100)
      : baseQ.where('business_id', '=', bizId).where('status', '=', 'pending');

    const rows = await q.execute();
    const imports = rows
      .filter(r => !typeFilter || r.invoice_type === typeFilter)
      .map(r => ({ ...r, line_items: safeJson(r.line_items) as StagedLine[] }));

    // Resolve per-line suggestions for anything still awaiting review. History
    // rows are already decided. One context is loaded per invoice, since the
    // learned rules and prior-bill history are vendor-specific.
    if (!history) {
      const serviceCtx = ctx(req);
      for (const imp of imports) {
        const lines = imp.line_items ?? [];
        if (lines.length === 0) continue;
        // eslint-disable-next-line no-await-in-loop
        const suggestions = await suggestInvoiceLines(db, serviceCtx, imp.vendor_customer, lines.map(li => ({
          description: li.description ?? '',
          amount: `${Math.abs(Number(li.amount ?? 0))}`,
          ai_suggested_account: li.suggested_account ?? null,
        })));
        lines.forEach((li, i) => {
          const suggestion = suggestions[i];
          if (!suggestion) { li.suggestion = null; return; }
          const accountId = suggestion.lines[0]?.account_id;
          if (accountId) li.suggested_account_id = accountId;
          li.suggestion = {
            confidence: suggestion.confidence,
            band: suggestion.band,
            source_layer: suggestion.source_layer,
          };
        });
      }
    }

    res.json({ imports });
  } catch (e) { next(e); }
});

type StagedLine = {
  description?: string;
  amount?: string;
  suggested_account?: string;
  suggested_account_id?: string;
  suggestion?: { confidence: number; band: string; source_layer: string } | null;
};

type LineItem = {
  description: string;
  quantity: string;
  unit_price: string;
  amount: string;
  suggested_account?: string;
};

// Serve the original PDF attachment
router.get(
  '/businesses/:businessId/invoice-imports/:importId/pdf',
  requireMinRole('staff'),
  async (req, res, next) => {
    try {
      const bizId = req.tenancy!.business_id;
      const row = await db
        .selectFrom('invoice_import_staging')
        .select(['pdf_data', 'invoice_number', 'gmail_message_id'])
        .where('id', '=', req.params['importId']!)
        .where('business_id', '=', bizId)
        .executeTakeFirst();
      if (!row?.pdf_data) { res.status(404).json({ error: 'PDF not available' }); return; }
      const filename = row.invoice_number ? `invoice-${row.invoice_number}.pdf` : `invoice-${row.gmail_message_id}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      res.send(row.pdf_data);
    } catch (e) { next(e); }
  },
);

const approveSchema = z.object({
  vendor_id: z.string().uuid().optional(),   // required for AP
  customer_id: z.string().uuid().optional(), // required for AR
  line_items: z.array(z.object({
    index: z.number().int().min(0),
    account_id: z.string().uuid(),
    include: z.boolean().default(true),
    /** "Use this account for future <line> from this vendor" was ticked. */
    remember: z.boolean().optional(),
  })).transform(items => items.filter(l => l.include)),
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

      // Recomputed server-side: this comparison decides what gets learned, so
      // it must not be client-controlled.
      const lineSuggestions = await suggestInvoiceLines(db, serviceCtx, staged.vendor_customer, lineItems.map(li => ({
        description: li.description ?? '',
        amount: `${Math.abs(Number(li.amount ?? 0))}`,
      })));

      await db.transaction().execute(async trx => {
        const totalTax = staged.tax_amount ? parseFloat(staged.tax_amount) : 0;
        // Use staged subtotal; fall back to summing included line amounts
        const subtotalBase = staged.subtotal ? parseFloat(staged.subtotal)
          : included.reduce((s, item) => s + parseFloat(lineItems[item.index]?.amount ?? '0'), 0);

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
            const lineAmt = parseFloat(li?.amount ?? '0');
            const lineTax = subtotalBase > 0 && totalTax > 0 ? (lineAmt / subtotalBase) * totalTax : 0;
            return {
              description: li?.description ?? '',
              quantity: '1',
              unit_price: (lineAmt + lineTax).toFixed(2),
              expense_account_id: item.account_id,
            };
          });
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

          // Learn only for AP. An AR line maps customer + line -> revenue,
          // which is a different key space than vendor + line -> expense.
          for (const item of included) {
            const li = lineItems[item.index];
            if (!li) continue;
            const suggested = lineSuggestions[item.index]?.lines[0]?.account_id ?? null;
            const changed = suggested !== item.account_id;
            const layer = lineSuggestions[item.index]?.source_layer ?? null;
            // Same policy as the bank side: an explicit request always writes a
            // rule; an existing learned rule accepted unchanged is reinforced;
            // a silently accepted guess writes nothing.
            if (item.remember !== true && !(!changed && layer === 'learned_rule')) continue;
            // eslint-disable-next-line no-await-in-loop
            await rememberInvoiceLineCoding(trx, serviceCtx, {
              vendor_name: staged.vendor_customer,
              description: li.description ?? '',
              account_id: item.account_id,
              amount: parseFloat(li.amount ?? '0').toFixed(4),
              was_correction: changed,
            });
          }
        } else {
          if (!body.customer_id) throw new Error('customer_id required for AR invoices');
          const invLines = included.map(item => {
            const li = lineItems[item.index];
            const lineAmt = parseFloat(li?.amount ?? '0');
            const lineTax = subtotalBase > 0 && totalTax > 0 ? (lineAmt / subtotalBase) * totalTax : 0;
            return {
              description: li?.description ?? '',
              quantity: '1',
              unit_price: (lineAmt + lineTax).toFixed(2),
              revenue_account_id: item.account_id,
              tax_code_id: null,
            };
          });
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
