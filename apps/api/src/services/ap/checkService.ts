import { sql, type Transaction, type Kysely } from 'kysely';
import { AUDIT } from '@accounting/shared';
import type { DB, CheckPayeeType } from '../../db/types.js';
import { NotFoundError } from '../../lib/errors.js';
import { PreconditionError } from '../../lib/ledgerErrors.js';
import { record as auditRecord } from '../audit/auditService.js';
import * as ledger from '../core/ledgerService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type CheckLineInput = {
  account_id: string;
  description?: string | null;
  amount: string;
};

export type CreateCheckInput = {
  payment_date: string;
  check_number?: string | null;
  payee_id?: string | null;
  payee_type?: CheckPayeeType | null;
  payee_text?: string | null;
  bank_account_id: string;
  mailing_address?: string | null;
  memo?: string | null;
  print_later?: boolean;
  lines: CheckLineInput[];
};

/** Same escape-hatch pattern as expenseTransactionService.voidGuardFor: echo
 * the JE's own source_type/source_id back so voidJournalEntry/deleteJournalEntry
 * accept a void/delete from this feature's own route. */
async function voidGuardFor(trx: Transaction<DB>, journal_entry_id: string) {
  const je = await trx.selectFrom('journal_entries')
    .select(['source_type', 'source_id'])
    .where('id', '=', journal_entry_id)
    .executeTakeFirst();
  return je?.source_id ? { source_guard: { source_type: je.source_type, source_id: je.source_id } } : {};
}

async function resolveBankAccount(trx: Transaction<DB>, bizId: string, bank_account_id: string) {
  const account = await trx.selectFrom('bank_accounts').selectAll()
    .where('id', '=', bank_account_id)
    .where('business_id', '=', bizId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!account) throw new NotFoundError('bank_accounts', bank_account_id);
  return account;
}

function validateCheckLines(lines: CheckLineInput[]) {
  if (lines.length === 0) throw new PreconditionError('A check needs at least one line');
  for (const l of lines) {
    if (!l.account_id) throw new PreconditionError('Every check line must have a category');
  }
}

function validateCheckTotal(total: number) {
  if (total <= 0) throw new PreconditionError('Check total must be greater than zero');
}

/** Debit every line's category account, credit the bank account for the total.
 * Same shape as expenseTransactionService.buildExpenseJeLines — a check is a
 * debit account for every line's category account, credit the payment account. */
function buildCheckJeLines(
  lines: CheckLineInput[], cashAccountId: string, total: number, memo: string | null | undefined,
): ledger.LineInput[] {
  const jeLines: ledger.LineInput[] = [];
  for (const line of lines) {
    const amount = parseFloat(line.amount);
    if (amount === 0) continue;
    jeLines.push({
      account_id: line.account_id,
      debit: amount.toFixed(2),
      credit: '0',
      memo: line.description ?? null,
    });
  }
  jeLines.push({
    account_id: cashAccountId,
    debit: '0',
    credit: total.toFixed(2),
    memo: memo ?? null,
  });
  return jeLines;
}

function payeeName(row: { vendor_name?: string | null; customer_name?: string | null; payee_text: string | null }): string | null {
  return row.vendor_name ?? row.customer_name ?? row.payee_text;
}

async function resolvePayeeName(
  trx: Transaction<DB>,
  input: { payee_text?: string | null; payee_id?: string | null; payee_type?: CheckPayeeType | null },
): Promise<string | null> {
  if (input.payee_id && input.payee_type === 'vendor') {
    const v = await trx.selectFrom('vendors').select('name').where('id', '=', input.payee_id).executeTakeFirst();
    return v?.name ?? input.payee_text ?? null;
  }
  if (input.payee_id && input.payee_type === 'customer') {
    const c = await trx.selectFrom('customers').select('name').where('id', '=', input.payee_id).executeTakeFirst();
    return c?.name ?? input.payee_text ?? null;
  }
  return input.payee_text ?? null;
}

async function isReconciled(db: Kysely<DB>, journal_entry_id: string | null): Promise<boolean> {
  if (!journal_entry_id) return false;
  const match = await db.selectFrom('bank_transactions')
    .select('id')
    .where('matched_journal_entry_id', '=', journal_entry_id)
    .where('is_reconciled', '=', true)
    .executeTakeFirst();
  return match !== undefined;
}

/**
 * Next check number for a bank account: one past the highest purely-numeric
 * check_number on file for it (physical checkbooks are per-account, so each
 * bank account keeps its own sequence). A non-numeric number (someone typed
 * "EFT-001") is skipped rather than breaking the sequence.
 */
export async function nextCheckNumber(
  db: Kysely<DB>, business_id: string, bank_account_id: string,
): Promise<string> {
  const row = await sql<{ next: string }>`
    SELECT COALESCE(MAX(CAST(check_number AS INTEGER)), 0) + 1 AS next
    FROM checks
    WHERE business_id = ${business_id} AND bank_account_id = ${bank_account_id}
    AND check_number ~ '^[0-9]+$'
  `.execute(db);
  return String(row.rows[0]?.next ?? 1);
}

/**
 * The account this vendor's checks/expenses most recently used, so the first
 * line's category can be pre-filled the way QBO "learns" a payee's usual
 * category. Looks across both checks and expenses, since either could be the
 * more recent one; only ever called for a vendor payee.
 */
export async function vendorDefaultCategory(
  db: Kysely<DB>, business_id: string, vendor_id: string,
): Promise<string | null> {
  const row = await sql<{ account_id: string }>`
    SELECT account_id, COUNT(*) AS usage_count, MAX(payment_date) AS last_used
    FROM (
      SELECT cl.account_id, c.payment_date
      FROM checks c JOIN check_lines cl ON cl.check_id = c.id
      WHERE c.payee_id = ${vendor_id} AND c.payee_type = 'vendor' AND c.business_id = ${business_id}
      UNION ALL
      SELECT el.category_account_id AS account_id, e.transaction_date AS payment_date
      FROM expense_transactions e JOIN expense_transaction_lines el ON el.expense_transaction_id = e.id
      WHERE e.vendor_id = ${vendor_id} AND e.business_id = ${business_id}
    ) sub
    GROUP BY account_id
    ORDER BY usage_count DESC, last_used DESC
    LIMIT 1
  `.execute(db);
  return row.rows[0]?.account_id ?? null;
}

export async function createCheck(trx: Transaction<DB>, ctx: ServiceCtx, input: CreateCheckInput) {
  const bizId = ctx.business_id!;
  if (!input.payee_text && !input.payee_id) {
    throw new PreconditionError('A payee is required');
  }

  const bankAccount = await resolveBankAccount(trx, bizId, input.bank_account_id);
  validateCheckLines(input.lines);
  const total = input.lines.reduce((sum, l) => sum + parseFloat(l.amount), 0);
  validateCheckTotal(total);

  const checkNumber = input.check_number?.trim() || await nextCheckNumber(trx as unknown as Kysely<DB>, bizId, input.bank_account_id);

  // Insert as a draft first — the row needs an id before the JE can point
  // back at it as source_id, so posting can't happen in the same insert.
  const check = await trx.insertInto('checks').values({
    business_id: bizId,
    check_number: checkNumber,
    payee_id: input.payee_id ?? null,
    payee_type: input.payee_id ? (input.payee_type ?? null) : null,
    payee_text: input.payee_text ?? null,
    bank_account_id: input.bank_account_id,
    payment_date: input.payment_date,
    mailing_address: input.mailing_address ?? null,
    memo: input.memo ?? null,
    total_amount: total.toFixed(2),
    print_later: input.print_later ?? false,
    created_by_user_id: ctx.user_id,
  }).returningAll().executeTakeFirstOrThrow();

  await trx.insertInto('check_lines').values(
    input.lines.map((l, i) => ({
      check_id: check.id,
      business_id: bizId,
      line_number: i + 1,
      account_id: l.account_id,
      description: l.description ?? null,
      amount: l.amount,
    })),
  ).execute();

  const je = await ledger.postJournalEntry(trx, ctx, {
    business_id: bizId,
    entry_date: input.payment_date,
    source_type: 'check',
    source_id: check.id,
    transaction_type: 'check',
    payee_name: await resolvePayeeName(trx, input),
    memo: input.memo ?? null,
    reference: checkNumber,
    lines: buildCheckJeLines(input.lines, bankAccount.cash_account_id, total, input.memo),
  });

  const updated = await trx.updateTable('checks')
    .set({
      status: 'posted',
      journal_entry_id: je.id,
      posted_at: sql`now()`,
      posted_by_user_id: ctx.user_id,
    })
    .where('id', '=', check.id)
    .returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.CHECK_CREATE,
    entity_type: 'check',
    entity_id: check.id,
    before: null,
    after: { ...updated, lines: input.lines },
  });

  return updated;
}

/** Edit a check in place (same id): void the old JE and post a replacement,
 * same pattern as updateExpense/updateDeposit. */
export async function updateCheck(
  trx: Transaction<DB>, ctx: ServiceCtx, id: string, input: CreateCheckInput,
) {
  const bizId = ctx.business_id!;
  const before = await trx.selectFrom('checks').selectAll()
    .where('id', '=', id)
    .where('business_id', '=', bizId)
    .forUpdate()
    .executeTakeFirst();
  if (!before) throw new NotFoundError('check', id);
  if (before.status === 'void') throw new PreconditionError('A voided check cannot be edited');

  if (!input.payee_text && !input.payee_id) {
    throw new PreconditionError('A payee is required');
  }

  const existingLines = await trx.selectFrom('check_lines').selectAll()
    .where('check_id', '=', id)
    .orderBy('line_number', 'asc')
    .execute();

  const bankAccount = await resolveBankAccount(trx, bizId, input.bank_account_id);
  validateCheckLines(input.lines);
  const total = input.lines.reduce((sum, l) => sum + parseFloat(l.amount), 0);
  validateCheckTotal(total);
  const checkNumber = input.check_number?.trim() || before.check_number;

  if (before.journal_entry_id) {
    await ledger.voidJournalEntry(trx, ctx, {
      journal_entry_id: before.journal_entry_id,
      void_reason: 'Check edited',
      // Reverse on the original's own date, not today.
      reversal_date: before.payment_date,
      ...(await voidGuardFor(trx, before.journal_entry_id)),
    });
  }

  await trx.deleteFrom('check_lines').where('check_id', '=', id).execute();
  await trx.insertInto('check_lines').values(
    input.lines.map((l, i) => ({
      check_id: id,
      business_id: bizId,
      line_number: i + 1,
      account_id: l.account_id,
      description: l.description ?? null,
      amount: l.amount,
    })),
  ).execute();

  const je = await ledger.postJournalEntry(trx, ctx, {
    business_id: bizId,
    entry_date: input.payment_date,
    source_type: 'check',
    source_id: id,
    transaction_type: 'check',
    payee_name: await resolvePayeeName(trx, input),
    memo: input.memo ?? null,
    reference: checkNumber,
    lines: buildCheckJeLines(input.lines, bankAccount.cash_account_id, total, input.memo),
  });

  const updated = await trx.updateTable('checks').set({
    check_number: checkNumber,
    payee_id: input.payee_id ?? null,
    payee_type: input.payee_id ? (input.payee_type ?? null) : null,
    payee_text: input.payee_text ?? null,
    bank_account_id: input.bank_account_id,
    payment_date: input.payment_date,
    mailing_address: input.mailing_address ?? null,
    memo: input.memo ?? null,
    total_amount: total.toFixed(2),
    print_later: input.print_later ?? false,
    journal_entry_id: je.id,
  }).where('id', '=', id).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.CHECK_UPDATE,
    entity_type: 'check',
    entity_id: id,
    before: { ...before, lines: existingLines },
    after: { ...updated, lines: input.lines },
  });

  return updated;
}

export async function voidCheck(
  trx: Transaction<DB>, ctx: ServiceCtx, input: { check_id: string; void_reason?: string | null },
) {
  const before = await trx.selectFrom('checks').selectAll()
    .where('id', '=', input.check_id)
    .where('business_id', '=', ctx.business_id!)
    .forUpdate()
    .executeTakeFirst();
  if (!before) throw new NotFoundError('check', input.check_id);
  if (before.status === 'void') throw new PreconditionError('This check is already void');

  if (before.journal_entry_id) {
    await ledger.voidJournalEntry(trx, ctx, {
      journal_entry_id: before.journal_entry_id,
      void_reason: input.void_reason ?? 'Check voided',
      reversal_date: before.payment_date,
      ...(await voidGuardFor(trx, before.journal_entry_id)),
    });
  }

  const updated = await trx.updateTable('checks').set({
    status: 'void',
    voided_at: sql`now()`,
    voided_by_user_id: ctx.user_id,
  }).where('id', '=', input.check_id).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.CHECK_VOID,
    entity_type: 'check',
    entity_id: updated.id,
    before, after: updated,
  });
  return updated;
}

/** Remove a check entirely (QBO "Delete"). Same hard-delete pattern as
 * deleteExpense: the JE is hard-deleted via ledger.deleteJournalEntry, not
 * just voided, so nothing is left in the General Ledger once this returns. */
export async function deleteCheck(trx: Transaction<DB>, ctx: ServiceCtx, id: string) {
  const bizId = ctx.business_id!;
  const before = await trx.selectFrom('checks').selectAll()
    .where('id', '=', id)
    .where('business_id', '=', bizId)
    .executeTakeFirst();
  if (!before) throw new NotFoundError('check', id);

  if (await isReconciled(trx, before.journal_entry_id)) {
    throw new PreconditionError('This check has been reconciled and cannot be deleted.');
  }

  const lines = await trx.selectFrom('check_lines').selectAll()
    .where('check_id', '=', id).execute();

  const guard = before.journal_entry_id ? await voidGuardFor(trx, before.journal_entry_id) : {};
  await trx.deleteFrom('checks').where('id', '=', id).execute();

  if (before.journal_entry_id) {
    await ledger.deleteJournalEntry(trx, ctx, {
      journal_entry_id: before.journal_entry_id,
      ...guard,
    });
  }

  await auditRecord(trx, ctx, {
    action: AUDIT.CHECK_DELETE,
    entity_type: 'check',
    entity_id: id,
    before: { ...before, lines },
    after: null,
  });
}

export async function getCheck(db: Kysely<DB>, ctx: ServiceCtx, id: string) {
  const row = await db.selectFrom('checks as c')
    .leftJoin('vendors as v', 'v.id', 'c.payee_id')
    .leftJoin('customers as cu', 'cu.id', 'c.payee_id')
    .innerJoin('bank_accounts as ba', 'ba.id', 'c.bank_account_id')
    .innerJoin('chart_of_accounts as cash', 'cash.id', 'ba.cash_account_id')
    .select([
      'c.id', 'c.business_id', 'c.check_number', 'c.payee_id', 'c.payee_type', 'c.payee_text',
      'c.bank_account_id', 'c.payment_date', 'c.mailing_address', 'c.memo', 'c.total_amount',
      'c.print_later', 'c.is_printed', 'c.status', 'c.journal_entry_id', 'c.created_at', 'c.updated_at',
      'c.posted_at', 'c.voided_at',
      'v.name as vendor_name', 'cu.name as customer_name',
      'ba.name as bank_account_name', 'cash.code as cash_account_code', 'cash.name as cash_account_name',
    ])
    .where('c.id', '=', id)
    .where('c.business_id', '=', ctx.business_id!)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('check', id);

  const lines = await db.selectFrom('check_lines as l')
    .innerJoin('chart_of_accounts as a', 'a.id', 'l.account_id')
    .select([
      'l.id', 'l.account_id', 'l.description', 'l.amount', 'l.line_number',
      'a.name as account_name', 'a.code as account_code',
    ])
    .where('l.check_id', '=', id)
    .orderBy('l.line_number', 'asc')
    .execute();

  return {
    ...row,
    payee_name: payeeName(row),
    editable: row.status !== 'void',
    is_reconciled: await isReconciled(db, row.journal_entry_id),
    lines,
  };
}

export async function listChecks(db: Kysely<DB>, ctx: ServiceCtx) {
  const rows = await db.selectFrom('checks as c')
    .leftJoin('vendors as v', 'v.id', 'c.payee_id')
    .leftJoin('customers as cu', 'cu.id', 'c.payee_id')
    .innerJoin('bank_accounts as ba', 'ba.id', 'c.bank_account_id')
    .select([
      'c.id', 'c.check_number', 'c.payment_date', 'c.payee_text', 'c.memo',
      'c.total_amount', 'c.bank_account_id', 'c.status', 'c.journal_entry_id', 'c.updated_at',
      'v.name as vendor_name', 'cu.name as customer_name', 'ba.name as bank_account_name',
    ])
    .where('c.business_id', '=', ctx.business_id!)
    .orderBy('c.payment_date', 'desc')
    .execute();
  return rows.map(row => ({ ...row, payee_name: payeeName(row) }));
}
