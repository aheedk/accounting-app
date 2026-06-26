import { sql, type Transaction, type Kysely } from 'kysely';
import { AUDIT, ERR } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import { BusinessRuleError, NotFoundError } from '../../lib/errors.js';
import { record as auditRecord } from '../audit/auditService.js';
import { postJournalEntry } from '../core/ledgerService.js';
import { nextCounter } from '../core/numberingService.js';
import { createDraft as createInvoiceDraft } from '../ar/invoiceService.js';
import { createDraft as createBillDraft } from '../ap/billService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type CreateTemplateInput = {
  business_id: string;
  name: string;
  template_type: 'journal_entry' | 'invoice' | 'bill';
  payload: unknown;
  recurrence: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  next_run_date: string;
  end_date?: string | null;
};

export async function create(trx: Transaction<DB>, ctx: ServiceCtx, input: CreateTemplateInput) {
  // Build conditional patch (no undefined values; exactOptionalPropertyTypes-safe).
  const values: {
    business_id: string;
    name: string;
    template_type: 'journal_entry' | 'invoice' | 'bill';
    payload: object;
    recurrence: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
    next_run_date: string;
    end_date?: string | null;
    created_by_user_id: string;
  } = {
    business_id: input.business_id,
    name: input.name,
    template_type: input.template_type,
    payload: input.payload as object,
    recurrence: input.recurrence,
    next_run_date: input.next_run_date,
    created_by_user_id: ctx.user_id,
  };
  if (input.end_date !== undefined) values.end_date = input.end_date;

  const row = await trx.insertInto('recurring_templates').values(values).returningAll().executeTakeFirstOrThrow();
  await auditRecord(trx, ctx, {
    action: AUDIT.RECURRING_TEMPLATE_CREATE,
    entity_type: 'recurring_template',
    entity_id: row.id,
    before: null,
    after: row,
  });
  return row;
}

export async function listTemplates(db: Kysely<DB>, business_id: string) {
  return db.selectFrom('recurring_templates').selectAll()
    .where('business_id', '=', business_id)
    .orderBy('next_run_date').execute();
}

function addDays(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function advanceDate(date: string, recurrence: 'weekly' | 'monthly' | 'quarterly' | 'yearly'): string {
  const d = new Date(date + 'T00:00:00Z');
  switch (recurrence) {
    case 'weekly':    d.setUTCDate(d.getUTCDate() + 7); break;
    case 'monthly':   d.setUTCMonth(d.getUTCMonth() + 1); break;
    case 'quarterly': d.setUTCMonth(d.getUTCMonth() + 3); break;
    case 'yearly':    d.setUTCFullYear(d.getUTCFullYear() + 1); break;
  }
  return d.toISOString().slice(0, 10);
}

export async function runDue(
  trx: Transaction<DB>, ctx: ServiceCtx, business_id: string,
): Promise<{ template_id: string; runs_created: number }[]> {
  const today = new Date().toISOString().slice(0, 10);
  const due = await trx.selectFrom('recurring_templates').selectAll()
    .where('business_id', '=', business_id)
    .where('is_active', '=', true)
    .where('next_run_date', '<=', today)
    .execute();

  const results: { template_id: string; runs_created: number }[] = [];
  for (const t of due) {
    let runs = 0;
    let nextDate = t.next_run_date;
    while (nextDate <= today && (t.end_date == null || nextDate <= t.end_date)) {
      if (t.template_type === 'journal_entry') {
        const payload = t.payload as {
          lines: Array<{ account_id: string; debit: string; credit: string; memo?: string | null }>;
          memo?: string | null;
          reference?: string | null;
        };
        await postJournalEntry(trx, ctx, {
          business_id: t.business_id,
          entry_date: nextDate,
          source_type: 'manual',
          memo: payload.memo ?? `Recurring: ${t.name}`,
          reference: payload.reference ?? null,
          lines: payload.lines.map(l => ({
            account_id: l.account_id,
            debit: l.debit,
            credit: l.credit,
            memo: l.memo ?? null,
          })),
        });
      } else if (t.template_type === 'invoice') {
        const payload = t.payload as {
          customer_id: string;
          due_days?: number | null;
          memo?: string | null;
          terms?: string | null;
          lines: Array<{
            description: string;
            quantity: string;
            unit_price: string;
            revenue_account_id: string;
            tax_code_id?: string | null;
          }>;
        };
        const n = await nextCounter(trx, t.business_id, 'invoice');
        await createInvoiceDraft(trx, ctx, {
          business_id: t.business_id,
          customer_id: payload.customer_id,
          invoice_number: `INV-${String(n).padStart(4, '0')}`,
          issue_date: nextDate,
          due_date: addDays(nextDate, payload.due_days ?? 30),
          memo: payload.memo ?? `Recurring: ${t.name}`,
          terms: payload.terms ?? null,
          lines: payload.lines.map(l => ({
            description: l.description,
            quantity: l.quantity,
            unit_price: l.unit_price,
            revenue_account_id: l.revenue_account_id,
            tax_code_id: l.tax_code_id ?? null,
          })),
        });
      } else if (t.template_type === 'bill') {
        const payload = t.payload as {
          vendor_id: string;
          due_days?: number | null;
          memo?: string | null;
          terms?: string | null;
          lines: Array<{
            description: string;
            quantity: string;
            unit_price: string;
            expense_account_id: string;
          }>;
        };
        const n = await nextCounter(trx, t.business_id, 'bill');
        await createBillDraft(trx, ctx, {
          business_id: t.business_id,
          vendor_id: payload.vendor_id,
          bill_number: `BILL-${String(n).padStart(4, '0')}`,
          bill_date: nextDate,
          due_date: addDays(nextDate, payload.due_days ?? 30),
          memo: payload.memo ?? `Recurring: ${t.name}`,
          terms: payload.terms ?? null,
          lines: payload.lines.map(l => ({
            description: l.description,
            quantity: l.quantity,
            unit_price: l.unit_price,
            expense_account_id: l.expense_account_id,
          })),
        });
      } else {
        throw new BusinessRuleError(ERR.PRECONDITION_FAILED, `unknown template_type: ${String((t as { template_type: unknown }).template_type)}`);
      }
      runs++;
      nextDate = advanceDate(nextDate, t.recurrence);
    }
    await trx.updateTable('recurring_templates')
      .set({ next_run_date: nextDate, last_run_at: sql`now()` })
      .where('id', '=', t.id).execute();
    await auditRecord(trx, ctx, {
      action: AUDIT.RECURRING_TEMPLATE_RUN,
      entity_type: 'recurring_template',
      entity_id: t.id,
      before: t,
      after: { runs_created: runs, advanced_to: nextDate },
    });
    results.push({ template_id: t.id, runs_created: runs });
  }
  return results;
}

export async function deleteTemplate(
  trx: Transaction<DB>, ctx: ServiceCtx, input: { template_id: string },
) {
  const before = await trx.selectFrom('recurring_templates').selectAll()
    .where('id', '=', input.template_id).executeTakeFirst();
  if (!before) throw new NotFoundError('recurring_template', input.template_id);
  await trx.deleteFrom('recurring_templates').where('id', '=', input.template_id).execute();
  await auditRecord(trx, ctx, {
    action: AUDIT.RECURRING_TEMPLATE_DELETE,
    entity_type: 'recurring_template',
    entity_id: input.template_id,
    before,
    after: null,
  });
}
