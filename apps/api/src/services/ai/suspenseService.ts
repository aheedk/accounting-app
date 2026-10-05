import { sql, type Kysely, type Transaction } from 'kysely';
import { AUDIT, ERR } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import type { ServiceCtx } from '../../lib/ctx.js';
import { BusinessRuleError } from '../../lib/errors.js';
import { record as auditRecord } from '../audit/auditService.js';
import { findSuspenseAccount } from '../core/chartOfAccountsService.js';
import { postJournalEntry } from '../core/ledgerService.js';
import { describeTransactions } from '../core/transactionDescriptorService.js';
import { updateExpense } from '../ap/expenseTransactionService.js';
import { updateImportedTransaction } from '../banking/importedTransactionService.js';
import { rememberCoding } from './autoCodingService.js';

/**
 * Suspense: where the AI parks lines it cannot code until someone says what
 * they were. Spec: docs/specs/2026-10-04-suspense-account-design.md
 */

export type SuspenseItem = {
  journal_entry_id: string;
  entry_date: string;
  /** "Expense", "Check", "Deposit", "Bill"... */
  label: string;
  num: string | null;
  payee: string | null;
  /** The statement description or line text that could not be coded. */
  description: string | null;
  /** Still in Suspense, positive. */
  amount: string;
  /** Money out (Suspense was debited) or money in (credited). */
  direction: 'out' | 'in';
  /** The bank or card account on the other side, when there is one. */
  bank_account_name: string | null;
  path: string;
  age_days: number;
};

function requireBusiness(ctx: ServiceCtx): string {
  if (!ctx.business_id) throw new BusinessRuleError(ERR.NOT_FOUND, 'No business selected');
  return ctx.business_id;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Per entry, what is still in Suspense: the entry's own Suspense lines, less
 * reclassification entries that moved part of it out (an entry edited in place
 * no longer has a Suspense line, so it simply drops off).
 */
async function openAmounts(
  db: Kysely<DB> | Transaction<DB>,
  businessId: string,
  suspenseId: string,
  onlyEntryId?: string,
): Promise<Map<string, { net: number; memo: string | null }>> {
  let q = db.selectFrom('journal_entry_lines as l')
    .innerJoin('journal_entries as e', 'e.id', 'l.journal_entry_id')
    .select([
      'e.id',
      sql<string>`sum(l.debit - l.credit)`.as('net'),
      sql<string | null>`max(l.memo)`.as('memo'),
    ])
    .where('e.business_id', '=', businessId)
    .where('e.status', '=', 'posted')
    .where('e.source_type', '!=', 'reversal')
    .where('l.account_id', '=', suspenseId)
    // A reclassification entry is the cure, not an item.
    .where(eb => eb.not(eb.exists(
      eb.selectFrom('suspense_reclassifications as r').select('r.id')
        .whereRef('r.result_journal_entry_id', '=', 'e.id')
        .where('r.method', '=', 'journal_entry'),
    )))
    .groupBy('e.id');
  if (onlyEntryId) q = q.where('e.id', '=', onlyEntryId);
  const rows = await q.execute();

  const moved = await db.selectFrom('suspense_reclassifications as r')
    .innerJoin('journal_entries as re', 're.id', 'r.result_journal_entry_id')
    .select(['r.journal_entry_id', sql<string>`sum(r.amount)`.as('amount')])
    .where('r.business_id', '=', businessId)
    .where('r.method', '=', 'journal_entry')
    .where('re.status', '=', 'posted')
    .groupBy('r.journal_entry_id')
    .execute();
  const movedBy = new Map(moved.map(m => [m.journal_entry_id, Number(m.amount)]));

  const out = new Map<string, { net: number; memo: string | null }>();
  for (const row of rows) {
    const net = Number(row.net);
    const remaining = round2(Math.abs(net) - (movedBy.get(row.id) ?? 0));
    if (remaining >= 0.01) out.set(row.id, { net: Math.sign(net) * remaining, memo: row.memo });
  }
  return out;
}

export async function listSuspenseItems(db: Kysely<DB>, ctx: ServiceCtx): Promise<{ account_id: string | null; items: SuspenseItem[] }> {
  const businessId = requireBusiness(ctx);
  const suspense = await findSuspenseAccount(db, businessId);
  if (!suspense) return { account_id: null, items: [] };
  const open = await openAmounts(db, businessId, suspense.id);
  if (open.size === 0) return { account_id: suspense.id, items: [] };

  const entries = await db.selectFrom('journal_entries')
    .select(['id', 'entry_date', 'source_type', 'source_id', 'transaction_type', 'payee_name', 'reference', 'journal_number', 'memo'])
    .where('id', 'in', [...open.keys()])
    .execute();
  const labels = await describeTransactions(db, entries.map(e => ({
    ...e, transaction_type: e.transaction_type ?? null, payee_name: e.payee_name ?? null, reference: e.reference ?? null,
  })));
  const banks = await db.selectFrom('journal_entry_lines as l')
    .innerJoin('chart_of_accounts as a', 'a.id', 'l.account_id')
    .innerJoin('bank_accounts as b', 'b.cash_account_id', 'a.id')
    .select(['l.journal_entry_id', 'a.name'])
    .where('l.journal_entry_id', 'in', [...open.keys()])
    .execute();
  const bankBy = new Map(banks.map(b => [b.journal_entry_id, b.name]));
  const cards = await db.selectFrom('journal_entry_lines as l')
    .innerJoin('chart_of_accounts as a', 'a.id', 'l.account_id')
    .select(['l.journal_entry_id', 'a.name'])
    .where('l.journal_entry_id', 'in', [...open.keys()])
    .where('a.detail_type', '=', 'Credit Card')
    .execute();
  for (const c of cards) if (!bankBy.has(c.journal_entry_id)) bankBy.set(c.journal_entry_id, c.name);

  const today = Date.now();
  const items = entries.map((e): SuspenseItem => {
    const o = open.get(e.id)!;
    const d = labels.get(e.id);
    const date = String(e.entry_date).slice(0, 10);
    return {
      journal_entry_id: e.id,
      entry_date: date,
      label: d?.label ?? 'Journal Entry',
      num: d?.num ?? null,
      payee: d?.name ?? e.payee_name ?? null,
      description: o.memo ?? d?.memo ?? e.memo ?? null,
      amount: Math.abs(o.net).toFixed(2),
      direction: o.net > 0 ? 'out' : 'in',
      bank_account_name: bankBy.get(e.id) ?? null,
      path: d?.path ?? `/journal/${e.id}`,
      age_days: Math.max(0, Math.floor((today - Date.parse(`${date}T00:00:00Z`)) / 86_400_000)),
    };
  });
  items.sort((a, b) => a.entry_date.localeCompare(b.entry_date));
  return { account_id: suspense.id, items };
}

/** Suspense balance at a date, for period close. Positive or negative; "0.00" when clear. */
export async function suspenseBalance(db: Kysely<DB> | Transaction<DB>, businessId: string, asOf: string): Promise<string> {
  const suspense = await findSuspenseAccount(db, businessId);
  if (!suspense) return '0.00';
  const row = await db.selectFrom('journal_entry_lines as l')
    .innerJoin('journal_entries as e', 'e.id', 'l.journal_entry_id')
    .select(sql<string>`coalesce(sum(l.debit - l.credit), 0)`.as('balance'))
    .where('e.business_id', '=', businessId)
    // As the balance sheet does: a voided entry still counts, netted by its reversal.
    .where('e.status', 'in', ['posted', 'voided'])
    .where('e.entry_date', '<=', asOf)
    .where('l.account_id', '=', suspense.id)
    .executeTakeFirstOrThrow();
  return round2(Number(row.balance)).toFixed(2);
}

/**
 * Move one entry's Suspense amount to the account it belongs in. Bank
 * statement lines and expenses are corrected in place; anything else gets a
 * reclassification entry dated like the original.
 */
export async function reclassifySuspenseItem(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: { journal_entry_id: string; account_id: string; remember?: boolean },
): Promise<{ method: 'edited' | 'journal_entry'; journal_entry_id: string }> {
  const businessId = requireBusiness(ctx);
  const suspense = await findSuspenseAccount(trx, businessId);
  if (!suspense) throw new BusinessRuleError(ERR.NOT_FOUND, 'This client has no Suspense account');
  if (input.account_id === suspense.id) {
    throw new BusinessRuleError(ERR.VALIDATION_FAILED, 'Pick the account this belongs in, not Suspense');
  }
  const target = await trx.selectFrom('chart_of_accounts').select(['id', 'is_active'])
    .where('id', '=', input.account_id).where('business_id', '=', businessId).executeTakeFirst();
  if (!target?.is_active) throw new BusinessRuleError(ERR.NOT_FOUND, 'Account not found');

  const entry = await trx.selectFrom('journal_entries').selectAll()
    .where('id', '=', input.journal_entry_id).where('business_id', '=', businessId)
    .forUpdate().executeTakeFirst();
  if (!entry) throw new BusinessRuleError(ERR.NOT_FOUND, 'Transaction not found');
  const open = (await openAmounts(trx, businessId, suspense.id, entry.id)).get(entry.id);
  if (!open) throw new BusinessRuleError(ERR.PRECONDITION_FAILED, 'Nothing from this transaction is left in Suspense');
  const amount = Math.abs(open.net).toFixed(2);
  const lines = await trx.selectFrom('journal_entry_lines').selectAll()
    .where('journal_entry_id', '=', entry.id).orderBy('line_number').execute();
  const entryDate = String(entry.entry_date).slice(0, 10);
  // Nothing has been moved out yet: the source can still be corrected in place.
  const untouched = round2(Math.abs(lines
    .filter(l => l.account_id === suspense.id)
    .reduce((sum, l) => sum + Number(l.debit) - Number(l.credit), 0))) === Number(amount);

  const expense = await trx.selectFrom('expense_transactions').selectAll()
    .where('journal_entry_id', '=', entry.id).where('business_id', '=', businessId).executeTakeFirst();

  let method: 'edited' | 'journal_entry';
  let resultEntryId: string;
  if (untouched && expense && expense.status !== 'void') {
    const expenseLines = await trx.selectFrom('expense_transaction_lines').selectAll()
      .where('expense_transaction_id', '=', expense.id).orderBy('sort_order').execute();
    const updated = await updateExpense(trx, ctx, expense.id, {
      transaction_date: String(expense.transaction_date).slice(0, 10),
      payee_text: expense.payee_text,
      vendor_id: expense.vendor_id,
      customer_id: expense.customer_id,
      payment_account_id: expense.payment_account_id,
      payment_method: expense.payment_method,
      reference: expense.reference,
      memo: expense.memo,
      lines: expenseLines.map((line, i) => ({
        category_account_id: line.category_account_id === suspense.id ? input.account_id : line.category_account_id,
        description: line.description,
        amount: Number(line.amount).toFixed(2),
        sort_order: line.sort_order ?? i,
      })),
    });
    if (!updated.journal_entry_id) throw new BusinessRuleError(ERR.INTERNAL, 'The expense did not repost');
    method = 'edited';
    resultEntryId = updated.journal_entry_id;
  } else if (untouched && entry.source_type === 'bank_import' && lines.length === 2 && !(await isWrappedDeposit(trx, entry.id))) {
    const bankLine = lines.find(l => l.account_id !== suspense.id)!;
    const inflow = Number(bankLine.debit) > 0;
    await updateImportedTransaction(trx, ctx, {
      journal_entry_id: entry.id,
      entry_date: entryDate,
      transaction_type: importedType(entry.transaction_type, inflow),
      payee_name: entry.payee_name ?? null,
      check_number: entry.transaction_type === 'check' ? entry.reference ?? null : null,
      memo: entry.memo ?? null,
      bank_account_id: bankLine.account_id,
      category_account_id: input.account_id,
      amount: (inflow ? Number(bankLine.debit) : Number(bankLine.credit)).toFixed(2),
    });
    method = 'edited';
    resultEntryId = entry.id;
  } else {
    // Suspense was debited for money out: debit the real account, credit Suspense.
    const out = open.net > 0;
    const posted = await postJournalEntry(trx, ctx, {
      business_id: businessId,
      entry_date: entryDate,
      source_type: 'adjustment',
      source_id: null,
      transaction_type: 'journal_entry',
      payee_name: entry.payee_name ?? null,
      memo: `Reclassify from Suspense: ${entry.memo ?? entry.payee_name ?? `entry ${entry.journal_number}`}`.slice(0, 1000),
      lines: [
        { account_id: input.account_id, debit: out ? amount : '0.00', credit: out ? '0.00' : amount, memo: open.memo },
        { account_id: suspense.id, debit: out ? '0.00' : amount, credit: out ? amount : '0.00', memo: open.memo },
      ],
    });
    method = 'journal_entry';
    resultEntryId = posted.id;
  }

  const record = await trx.insertInto('suspense_reclassifications').values({
    business_id: businessId,
    journal_entry_id: entry.id,
    method,
    result_journal_entry_id: resultEntryId,
    to_account_id: input.account_id,
    amount,
    created_by_user_id: ctx.user_id,
  }).returningAll().executeTakeFirstOrThrow();
  await auditRecord(trx, ctx, {
    action: AUDIT.SUSPENSE_RECLASSIFY,
    entity_type: 'journal_entry',
    entity_id: entry.id,
    before: { account_id: suspense.id, amount },
    after: record,
  });

  if (input.remember) {
    const described = open.memo ?? entry.memo ?? entry.payee_name ?? '';
    if (described.trim()) {
      const amt = Number(amount).toFixed(4);
      const out = open.net > 0;
      await rememberCoding(trx, ctx, {
        description: described,
        direction: out ? 'debit' : 'credit',
        bank_account_id: null,
        lines: [{ account_id: input.account_id, debit: out ? amt : '0.0000', credit: out ? '0.0000' : amt, memo: null }],
        was_correction: true,
      });
    }
  }
  return { method, journal_entry_id: resultEntryId };
}

async function isWrappedDeposit(trx: Transaction<DB>, journalEntryId: string): Promise<boolean> {
  const row = await trx.selectFrom('bank_deposits').select('id')
    .where('journal_entry_id', '=', journalEntryId).executeTakeFirst();
  return Boolean(row);
}

function importedType(
  type: string | null | undefined,
  inflow: boolean,
): 'check' | 'expense' | 'deposit' | 'credit_card_payment' | 'credit_card_credit' {
  if (type === 'check' || type === 'expense' || type === 'deposit' || type === 'credit_card_payment' || type === 'credit_card_credit') return type;
  return inflow ? 'deposit' : 'expense';
}
