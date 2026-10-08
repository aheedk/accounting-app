import { sql, type Transaction, type Kysely } from 'kysely';
import { AUDIT } from '@accounting/shared';
import type { DB, PaymentMethod } from '../../db/types.js';
import { NotFoundError } from '../../lib/errors.js';
import { PreconditionError } from '../../lib/ledgerErrors.js';
import { record as auditRecord } from '../audit/auditService.js';
import * as ledger from '../core/ledgerService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type ExpenseLineInput = {
  category_account_id: string;
  description?: string | null;
  amount: string;
  sort_order?: number;
};

export type CreateExpenseInput = {
  transaction_date: string;
  payee_text?: string | null;
  vendor_id?: string | null;
  customer_id?: string | null;
  payment_account_id: string;
  payment_method: PaymentMethod;
  reference?: string | null;
  memo?: string | null;
  lines: ExpenseLineInput[];
};

/**
 * Guard to pass when voiding an expense's JE: echo the JE's own source_type/
 * source_id back as the guard. New expenses post as 'expense', but historical
 * ones (pre-dating that dedicated type) still carry 'adjustment' —
 * je_protect_posted_row() treats source_type as permanent identity on a posted
 * JE, so there was never a migration that could reclassify them. Authorization
 * already happened via the tenant-scoped expense_transactions row lookup the
 * caller did to get here; this just satisfies voidJournalEntry's "only the
 * owning source may void this" check for either generation of row.
 */
async function voidGuardFor(trx: Transaction<DB>, journal_entry_id: string) {
  const je = await trx.selectFrom('journal_entries')
    .select(['source_type', 'source_id'])
    .where('id', '=', journal_entry_id)
    .executeTakeFirst();
  return je?.source_id ? { source_guard: { source_type: je.source_type, source_id: je.source_id } } : {};
}

/** Same lookup as voidGuardFor, unwrapped — for updateJournalEntry's source_guard,
 * which also needs the existing JE's own source_type as the replacement's
 * source_type (ledger identity can't change under an in-place edit; see
 * db/migrations/0065_journal_entry_in_place_edit.sql). */
async function existingJeSource(trx: Transaction<DB>, journal_entry_id: string) {
  const je = await trx.selectFrom('journal_entries')
    .select(['source_type', 'source_id'])
    .where('id', '=', journal_entry_id)
    .executeTakeFirstOrThrow();
  return je;
}

async function resolvePaymentAccount(trx: Transaction<DB>, bizId: string, payment_account_id: string) {
  const account = await trx.selectFrom('chart_of_accounts').selectAll()
    .where('id', '=', payment_account_id)
    .where('business_id', '=', bizId)
    .executeTakeFirst();
  if (!account) throw new NotFoundError('chart_of_accounts', payment_account_id);
  if (account.account_type !== 'asset' && account.account_type !== 'liability') {
    throw new PreconditionError('Payment account must be a bank/cash (asset) or credit card (liability) account');
  }
  return account;
}

/** Every line needs a category, and paying an account from itself is a no-op JE line. */
function validateExpenseLines(lines: ExpenseLineInput[], payment_account_id: string) {
  if (lines.length === 0) throw new PreconditionError('An expense needs at least one line');
  for (const l of lines) {
    if (!l.category_account_id) throw new PreconditionError('Every expense line must have a category');
    if (l.category_account_id === payment_account_id) {
      throw new PreconditionError('An expense line cannot use the same account as the payment account');
    }
  }
}

function validateExpenseTotal(total: number) {
  if (total <= 0) throw new PreconditionError('Expense total must be greater than zero');
}

/** Debit every line's category account, credit the payment account for the total. Shared by create and update so the JE shape never drifts between them. */
function buildExpenseJeLines(
  lines: ExpenseLineInput[],
  payment_account_id: string,
  total: number,
  memo: string | null | undefined,
): ledger.LineInput[] {
  const jeLines: ledger.LineInput[] = [];
  for (const line of lines) {
    const amount = parseFloat(line.amount);
    if (amount === 0) continue;
    jeLines.push({
      account_id: line.category_account_id,
      debit: amount.toFixed(2),
      credit: '0',
      memo: line.description ?? null,
    });
  }
  jeLines.push({
    account_id: payment_account_id,
    debit: '0',
    credit: total.toFixed(2),
    memo: memo ?? null,
  });
  return jeLines;
}

function payeeName(row: { vendor_name: string | null; customer_name: string | null; payee_text: string | null }): string | null {
  return row.vendor_name ?? row.customer_name ?? row.payee_text;
}

/** Resolve the payee's display name at write time, so the JE's own payee_name
 * column (read by generic reports that don't go through the expense's own
 * join) carries the real name — not just a free-text fallback. */
async function resolvePayeeName(
  trx: Transaction<DB>,
  input: { payee_text?: string | null; vendor_id?: string | null; customer_id?: string | null },
): Promise<string | null> {
  if (input.vendor_id) {
    const v = await trx.selectFrom('vendors').select('name').where('id', '=', input.vendor_id).executeTakeFirst();
    return v?.name ?? input.payee_text ?? null;
  }
  if (input.customer_id) {
    const c = await trx.selectFrom('customers').select('name').where('id', '=', input.customer_id).executeTakeFirst();
    return c?.name ?? input.payee_text ?? null;
  }
  return input.payee_text ?? null;
}

/** True once the expense's journal entry's bank-side line has gone through a bank reconciliation. */
async function isReconciled(db: Kysely<DB>, journal_entry_id: string | null): Promise<boolean> {
  if (!journal_entry_id) return false;
  const match = await db.selectFrom('bank_transactions')
    .select('id')
    .where('matched_journal_entry_id', '=', journal_entry_id)
    .where('is_reconciled', '=', true)
    .executeTakeFirst();
  return match !== undefined;
}

export async function createExpense(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: CreateExpenseInput,
) {
  const bizId = ctx.business_id!;
  if (!input.payee_text && !input.vendor_id && !input.customer_id) {
    throw new PreconditionError('A payee is required');
  }
  if (input.vendor_id && input.customer_id) {
    throw new PreconditionError('Pick one payee — a vendor or a customer, not both');
  }

  await resolvePaymentAccount(trx, bizId, input.payment_account_id);
  validateExpenseLines(input.lines, input.payment_account_id);
  const total = input.lines.reduce((sum, l) => sum + parseFloat(l.amount), 0);
  validateExpenseTotal(total);

  // Insert as a draft first (et_draft_no_je requires journal_entry_id/posted_at
  // to still be null here) — the row needs an id before the JE can point back
  // at it as source_id, so posting can't happen in the same insert.
  const expense = await trx.insertInto('expense_transactions').values({
    business_id: bizId,
    transaction_date: input.transaction_date,
    payee_text: input.payee_text ?? null,
    vendor_id: input.vendor_id ?? null,
    customer_id: input.customer_id ?? null,
    payment_account_id: input.payment_account_id,
    payment_method: input.payment_method,
    reference: input.reference ?? null,
    memo: input.memo ?? null,
    total_amount: total.toFixed(2),
    created_by_user_id: ctx.user_id,
  }).returningAll().executeTakeFirstOrThrow();

  await trx.insertInto('expense_transaction_lines').values(
    input.lines.map((l, i) => ({
      expense_transaction_id: expense.id,
      business_id: bizId,
      category_account_id: l.category_account_id,
      description: l.description ?? null,
      amount: l.amount,
      sort_order: l.sort_order ?? i,
    })),
  ).execute();

  const je = await ledger.postJournalEntry(trx, ctx, {
    business_id: bizId,
    entry_date: input.transaction_date,
    source_type: 'expense',
    source_id: expense.id,
    transaction_type: 'expense',
    payee_name: await resolvePayeeName(trx, input),
    memo: input.memo ?? null,
    reference: input.reference ?? null,
    lines: buildExpenseJeLines(input.lines, input.payment_account_id, total, input.memo),
  });

  const updated = await trx.updateTable('expense_transactions')
    .set({
      status: 'posted',
      journal_entry_id: je.id,
      posted_at: sql`now()`,
      posted_by_user_id: ctx.user_id,
    })
    .where('id', '=', expense.id)
    .returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.EXPENSE_TRANSACTION_CREATE,
    entity_type: 'expense_transaction',
    entity_id: expense.id,
    before: null,
    after: { ...updated, lines: input.lines },
  });

  return updated;
}

/**
 * Edit an expense in place (same id): void the old JE and post a replacement,
 * same pattern as updateDeposit. Voided expenses are blocked earlier, in the
 * route/page layer's read of `editable`; this function itself only refuses
 * when the row is actually void (defense in depth).
 */
export async function updateExpense(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  id: string,
  input: CreateExpenseInput,
) {
  const bizId = ctx.business_id!;
  const before = await trx.selectFrom('expense_transactions').selectAll()
    .where('id', '=', id)
    .where('business_id', '=', bizId)
    .forUpdate()
    .executeTakeFirst();
  if (!before) throw new NotFoundError('expense_transaction', id);
  if (before.status === 'void') throw new PreconditionError('A voided expense cannot be edited');

  if (!input.payee_text && !input.vendor_id && !input.customer_id) {
    throw new PreconditionError('A payee is required');
  }
  if (input.vendor_id && input.customer_id) {
    throw new PreconditionError('Pick one payee — a vendor or a customer, not both');
  }

  const existingLines = await trx.selectFrom('expense_transaction_lines').selectAll()
    .where('expense_transaction_id', '=', id)
    .orderBy('sort_order', 'asc')
    .execute();

  await resolvePaymentAccount(trx, bizId, input.payment_account_id);
  validateExpenseLines(input.lines, input.payment_account_id);
  const total = input.lines.reduce((sum, l) => sum + parseFloat(l.amount), 0);
  validateExpenseTotal(total);

  await trx.deleteFrom('expense_transaction_lines').where('expense_transaction_id', '=', id).execute();
  await trx.insertInto('expense_transaction_lines').values(
    input.lines.map((l, i) => ({
      expense_transaction_id: id,
      business_id: bizId,
      category_account_id: l.category_account_id,
      description: l.description ?? null,
      amount: l.amount,
      sort_order: l.sort_order ?? i,
    })),
  ).execute();

  // Edit in place (QBO parity): an edit is not a void. Changing the vendor,
  // memo, date, or line amounts/accounts updates the existing posted JE via
  // the controlled in-place-edit path (0065_journal_entry_in_place_edit.sql)
  // instead of voiding it and posting a replacement — same journal number,
  // same row in the GL, running balance unaffected. Void is reserved for the
  // explicit Void action.
  let journalEntryId = before.journal_entry_id;
  const jeLines = buildExpenseJeLines(input.lines, input.payment_account_id, total, input.memo);
  const payeeName = await resolvePayeeName(trx, input);
  if (before.journal_entry_id) {
    const existingSource = await existingJeSource(trx, before.journal_entry_id);
    const je = await ledger.updateJournalEntry(trx, ctx, {
      journal_entry_id: before.journal_entry_id,
      source_guard: { source_type: existingSource.source_type, source_id: existingSource.source_id! },
      replacement: {
        business_id: bizId,
        entry_date: input.transaction_date,
        source_type: existingSource.source_type,
        source_id: id,
        transaction_type: 'expense',
        payee_name: payeeName,
        memo: input.memo ?? null,
        reference: input.reference ?? null,
        lines: jeLines,
      },
    });
    journalEntryId = je.entry.id;
  } else {
    const je = await ledger.postJournalEntry(trx, ctx, {
      business_id: bizId,
      entry_date: input.transaction_date,
      source_type: 'expense',
      source_id: id,
      transaction_type: 'expense',
      payee_name: payeeName,
      memo: input.memo ?? null,
      reference: input.reference ?? null,
      lines: jeLines,
    });
    journalEntryId = je.id;
  }

  const updated = await trx.updateTable('expense_transactions').set({
    transaction_date: input.transaction_date,
    payee_text: input.payee_text ?? null,
    vendor_id: input.vendor_id ?? null,
    customer_id: input.customer_id ?? null,
    payment_account_id: input.payment_account_id,
    payment_method: input.payment_method,
    reference: input.reference ?? null,
    memo: input.memo ?? null,
    total_amount: total.toFixed(2),
    journal_entry_id: journalEntryId,
  }).where('id', '=', id).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.EXPENSE_TRANSACTION_UPDATE,
    entity_type: 'expense_transaction',
    entity_id: id,
    before: { ...before, lines: existingLines },
    after: { ...updated, lines: input.lines },
  });

  return updated;
}

export async function voidExpense(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: { expense_transaction_id: string; void_reason?: string },
) {
  const before = await trx.selectFrom('expense_transactions').selectAll()
    .where('id', '=', input.expense_transaction_id)
    .where('business_id', '=', ctx.business_id!)
    .forUpdate()
    .executeTakeFirst();
  if (!before) throw new NotFoundError('expense_transaction', input.expense_transaction_id);
  if (before.status === 'void') throw new PreconditionError('This expense is already void');

  if (before.journal_entry_id) {
    await ledger.voidJournalEntry(trx, ctx, {
      journal_entry_id: before.journal_entry_id,
      void_reason: input.void_reason ?? 'Expense voided',
      reversal_date: before.transaction_date,
      ...(await voidGuardFor(trx, before.journal_entry_id)),
    });
  }

  const updated = await trx.updateTable('expense_transactions').set({
    status: 'void',
    voided_at: sql`now()`,
    voided_by_user_id: ctx.user_id,
  }).where('id', '=', input.expense_transaction_id).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.EXPENSE_TRANSACTION_VOID,
    entity_type: 'expense_transaction',
    entity_id: updated.id,
    before, after: updated,
  });
  return updated;
}

/**
 * Remove an expense entirely (QBO "Delete"), as opposed to voidExpense, which
 * keeps the record and reverses the JE. The JE itself is hard-deleted via
 * ledger.deleteJournalEntry — not just voided — so nothing is left in the
 * General Ledger once this returns (deleteJournalEntry also cleans up an
 * existing void's reversal pair, for an expense that was voided first).
 */
export async function deleteExpense(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  id: string,
) {
  const bizId = ctx.business_id!;
  const before = await trx.selectFrom('expense_transactions').selectAll()
    .where('id', '=', id)
    .where('business_id', '=', bizId)
    .executeTakeFirst();
  if (!before) throw new NotFoundError('expense_transaction', id);

  if (await isReconciled(trx, before.journal_entry_id)) {
    throw new PreconditionError('This expense has been reconciled and cannot be deleted.');
  }

  const lines = await trx.selectFrom('expense_transaction_lines').selectAll()
    .where('expense_transaction_id', '=', id).execute();

  // The journal_entry_id FK must be gone before the JE itself can be deleted,
  // so resolve the guard (reads the JE) and delete the wrapper row first.
  const guard = before.journal_entry_id ? await voidGuardFor(trx, before.journal_entry_id) : {};
  await trx.deleteFrom('expense_transactions').where('id', '=', id).execute();

  if (before.journal_entry_id) {
    await ledger.deleteJournalEntry(trx, ctx, {
      journal_entry_id: before.journal_entry_id,
      ...guard,
    });
  }

  await auditRecord(trx, ctx, {
    action: AUDIT.EXPENSE_TRANSACTION_DELETE,
    entity_type: 'expense_transaction',
    entity_id: id,
    before: { ...before, lines },
    after: null,
  });
}

export async function getExpense(db: Kysely<DB>, ctx: ServiceCtx, id: string) {
  const row = await db.selectFrom('expense_transactions as e')
    .leftJoin('vendors as v', 'v.id', 'e.vendor_id')
    .leftJoin('customers as c', 'c.id', 'e.customer_id')
    .innerJoin('chart_of_accounts as pa', 'pa.id', 'e.payment_account_id')
    .select([
      'e.id', 'e.business_id', 'e.transaction_date', 'e.payee_text', 'e.vendor_id', 'e.customer_id',
      'e.payment_account_id', 'e.payment_method', 'e.reference', 'e.memo', 'e.total_amount',
      'e.status', 'e.journal_entry_id', 'e.created_at', 'e.updated_at',
      'e.posted_at', 'e.voided_at',
      'v.name as vendor_name', 'c.name as customer_name',
      'pa.name as payment_account_name',
    ])
    .where('e.id', '=', id)
    .where('e.business_id', '=', ctx.business_id!)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('expense_transaction', id);

  const lines = await db.selectFrom('expense_transaction_lines as l')
    .innerJoin('chart_of_accounts as a', 'a.id', 'l.category_account_id')
    .select([
      'l.id', 'l.category_account_id', 'l.description', 'l.amount', 'l.sort_order',
      'a.name as category_name', 'a.code as category_code',
    ])
    .where('l.expense_transaction_id', '=', id)
    .orderBy('l.sort_order', 'asc')
    .execute();

  // An expense wrapping a JE this feature didn't post itself (e.g. AI-coded
  // from a bank statement import) is still fully editable in place — just
  // informationally badged "Imported", same as Bank Deposits.
  let imported = false;
  if (row.journal_entry_id) {
    const je = await db.selectFrom('journal_entries').select('source_type')
      .where('id', '=', row.journal_entry_id)
      .executeTakeFirst();
    imported = je !== undefined && je.source_type !== 'expense';
  }

  return {
    ...row,
    payee_name: payeeName(row),
    editable: row.status !== 'void',
    imported,
    is_reconciled: await isReconciled(db, row.journal_entry_id),
    lines,
  };
}

export async function listExpenses(db: Kysely<DB>, ctx: ServiceCtx) {
  const rows = await db.selectFrom('expense_transactions as e')
    .leftJoin('vendors as v', 'v.id', 'e.vendor_id')
    .leftJoin('customers as c', 'c.id', 'e.customer_id')
    .innerJoin('chart_of_accounts as pa', 'pa.id', 'e.payment_account_id')
    .select([
      'e.id', 'e.transaction_date', 'e.payee_text', 'e.reference', 'e.memo',
      'e.total_amount', 'e.payment_account_id', 'e.payment_method', 'e.status',
      'e.journal_entry_id', 'e.updated_at',
      'v.name as vendor_name', 'c.name as customer_name',
      'pa.name as payment_account_name',
    ])
    .where('e.business_id', '=', ctx.business_id!)
    .orderBy('e.transaction_date', 'desc')
    .execute();
  return rows.map(row => ({ ...row, payee_name: payeeName(row) }));
}

export type WrapImportedExpenseInput = {
  journal_entry_id: string;
  /** chart_of_accounts id the JE's bank-side line posted to (what the import flow calls "bank_account_id") — used directly, since expense_transactions.payment_account_id is a CoA id, not a bank_accounts id. */
  payment_account_id: string;
  category_account_id: string;
  payment_method: PaymentMethod;
  entry_date: string;
  description: string;
  payee_name: string | null;
  amount: string;
};

/**
 * Give an externally-posted "expense"/"check" journal entry (AI-coded from a
 * bank statement import, see emailImports.ts) an expense_transactions wrapper
 * so it shows up and can be edited on the Expense page like any other expense
 * — same pattern as wrapImportedDepositJournalEntry. Never reposts or alters
 * the JE itself; getExpense flags a wrapped expense "imported" (informational
 * only — still fully editable, same as deposits).
 */
export async function wrapImportedExpenseJournalEntry(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: WrapImportedExpenseInput,
): Promise<{ id: string }> {
  const bizId = ctx.business_id!;

  const expense = await trx.insertInto('expense_transactions').values({
    business_id: bizId,
    transaction_date: input.entry_date,
    // A bank statement's description for a check line is usually just the
    // check number itself (e.g. "CHECK 5517") — falling back to it when
    // there's no real payee just relabels the check number as the payee.
    // et_payee requires payee_text to be non-null (or a vendor_id), so a
    // true null isn't possible, but an empty string is: it satisfies the
    // constraint and renders as blank — "—" — everywhere a contact/payee is
    // shown, the existing look for "no value", not a fake vendor name. Other
    // payment methods' own descriptions (ACH/wire/card) are actually
    // informative, so keep the fallback there.
    payee_text: input.payee_name ?? (input.payment_method === 'check' ? '' : input.description),
    payment_account_id: input.payment_account_id,
    payment_method: input.payment_method,
    memo: input.description,
    total_amount: input.amount,
    status: 'posted',
    journal_entry_id: input.journal_entry_id,
    posted_at: sql`now()`,
  }).returningAll().executeTakeFirstOrThrow();

  await trx.insertInto('expense_transaction_lines').values({
    expense_transaction_id: expense.id,
    business_id: bizId,
    category_account_id: input.category_account_id,
    description: input.description,
    amount: input.amount,
  }).execute();

  await auditRecord(trx, ctx, {
    action: AUDIT.EXPENSE_TRANSACTION_CREATE,
    entity_type: 'expense_transaction',
    entity_id: expense.id,
    before: null,
    after: expense,
  });

  return { id: expense.id };
}
