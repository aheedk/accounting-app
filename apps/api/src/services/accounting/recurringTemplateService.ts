import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import { AUDIT, ERR, schemas } from '@accounting/shared';
import type { DB, RecurringTemplatesTable } from '../../db/types.js';
import { BusinessRuleError, NotFoundError } from '../../lib/errors.js';
import { record as auditRecord } from '../audit/auditService.js';
import { postJournalEntry } from '../core/ledgerService.js';
import { nextNumber } from '../core/numberingService.js';
import * as invoiceService from '../ar/invoiceService.js';
import * as billService from '../ap/billService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type RecurringTemplateRow = Selectable<RecurringTemplatesTable>;

export type CreateTemplateInput = {
  business_id: string;
  name: string;
  template_type: 'journal_entry' | 'invoice' | 'bill';
  payload: unknown;
  recurrence: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  next_run_date: string;
  end_date?: string | null;
};

/** Validate a payload against the type-specific schema; returns the parsed payload (zod defaults applied). */
function parsePayload(
  template_type: 'journal_entry' | 'invoice' | 'bill', payload: unknown,
): object {
  const schema = template_type === 'journal_entry' ? schemas.recurringJePayloadSchema
    : template_type === 'invoice' ? schemas.recurringInvoicePayloadSchema
    : schemas.recurringBillPayloadSchema;
  const r = schema.safeParse(payload);
  if (!r.success) {
    const detail = r.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new BusinessRuleError(
      ERR.VALIDATION_FAILED,
      `invalid recurring ${template_type === 'journal_entry' ? 'journal entry' : template_type} payload: ${detail}`,
    );
  }
  return r.data;
}

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
    payload: parsePayload(input.template_type, input.payload),
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

export type UpdateTemplateInput = {
  template_id: string;
  patch: {
    name?: string;
    payload?: unknown;
    recurrence?: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
    next_run_date?: string;
    end_date?: string | null;
    is_active?: boolean;
  };
};

export async function update(trx: Transaction<DB>, ctx: ServiceCtx, input: UpdateTemplateInput) {
  const before = await trx.selectFrom('recurring_templates').selectAll()
    .where('id', '=', input.template_id).executeTakeFirst();
  if (!before) throw new NotFoundError('recurring_template', input.template_id);

  const patch: {
    name?: string;
    payload?: object;
    recurrence?: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
    next_run_date?: string;
    end_date?: string | null;
    is_active?: boolean;
  } = {};
  if (input.patch.name !== undefined) patch.name = input.patch.name;
  if (input.patch.payload !== undefined) patch.payload = parsePayload(before.template_type, input.patch.payload);
  if (input.patch.recurrence !== undefined) patch.recurrence = input.patch.recurrence;
  if (input.patch.next_run_date !== undefined) patch.next_run_date = input.patch.next_run_date;
  if (input.patch.end_date !== undefined) patch.end_date = input.patch.end_date;
  if (input.patch.is_active !== undefined) patch.is_active = input.patch.is_active;
  if (Object.keys(patch).length === 0) return before;

  const row = await trx.updateTable('recurring_templates').set(patch)
    .where('id', '=', input.template_id).returningAll().executeTakeFirstOrThrow();
  await auditRecord(trx, ctx, {
    action: AUDIT.RECURRING_TEMPLATE_UPDATE,
    entity_type: 'recurring_template',
    entity_id: row.id,
    before,
    after: row,
  });
  return row;
}

export type TemplateRunEntry = {
  at: RecurringTemplateRow['created_at'];
  runs_created: number;
  advanced_to: string;
};

/** Run history straight from the audit trail — no extra table needed. */
export async function listRuns(
  db: Kysely<DB>, business_id: string, template_id: string,
): Promise<TemplateRunEntry[]> {
  const rows = await db.selectFrom('audit_logs')
    .select(['created_at', 'after_state'])
    .where('business_id', '=', business_id)
    .where('entity_type', '=', 'recurring_template')
    .where('entity_id', '=', template_id)
    .where('action', '=', AUDIT.RECURRING_TEMPLATE_RUN)
    .orderBy('created_at', 'desc')
    .limit(50)
    .execute();
  return rows.map(r => {
    const raw: unknown = typeof r.after_state === 'string' ? JSON.parse(r.after_state) : r.after_state;
    const obj = (raw ?? {}) as { runs_created?: number; advanced_to?: string };
    return { at: r.created_at, runs_created: obj.runs_created ?? 0, advanced_to: obj.advanced_to ?? '' };
  });
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

function addDays(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function materializeOnce(
  trx: Transaction<DB>, ctx: ServiceCtx, t: RecurringTemplateRow, runDate: string,
): Promise<void> {
  if (t.template_type === 'journal_entry') {
    const payload = parsePayload('journal_entry', t.payload) as schemas.RecurringJePayload;
    await postJournalEntry(trx, ctx, {
      business_id: t.business_id,
      entry_date: runDate,
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
    const payload = parsePayload('invoice', t.payload) as schemas.RecurringInvoicePayload;
    const invoice_number = await nextNumber(trx, t.business_id, 'invoice', 'INV');
    const created = await invoiceService.createDraft(trx, ctx, {
      business_id: t.business_id,
      customer_id: payload.customer_id,
      invoice_number,
      issue_date: runDate,
      due_date: addDays(runDate, payload.due_days),
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
    await invoiceService.postInvoice(trx, ctx, { invoice_id: created.invoice.id });
  } else {
    const payload = parsePayload('bill', t.payload) as schemas.RecurringBillPayload;
    const bill_number = await nextNumber(trx, t.business_id, 'bill', 'BILL');
    const created = await billService.createDraft(trx, ctx, {
      business_id: t.business_id,
      vendor_id: payload.vendor_id,
      bill_number,
      bill_date: runDate,
      due_date: addDays(runDate, payload.due_days),
      memo: payload.memo ?? `Recurring: ${t.name}`,
      terms: payload.terms ?? null,
      lines: payload.lines.map(l => ({
        description: l.description,
        quantity: l.quantity,
        unit_price: l.unit_price,
        expense_account_id: l.expense_account_id,
      })),
    });
    await billService.postBill(trx, ctx, { bill_id: created.bill.id });
  }
}

/**
 * Materialize every run a single template owes up to `today`, advance its
 * next_run_date, and audit. Shared by the manual run-due route (via runDue)
 * and the in-process scheduler.
 */
export async function materializeDueTemplate(
  trx: Transaction<DB>, ctx: ServiceCtx, t: RecurringTemplateRow, today: string,
): Promise<{ template_id: string; runs_created: number }> {
  let runs = 0;
  let nextDate = t.next_run_date;
  while (nextDate <= today && (t.end_date == null || nextDate <= t.end_date)) {
    await materializeOnce(trx, ctx, t, nextDate);
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
  return { template_id: t.id, runs_created: runs };
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
    results.push(await materializeDueTemplate(trx, ctx, t, today));
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
