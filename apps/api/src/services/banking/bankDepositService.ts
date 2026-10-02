import { sql, type Transaction, type Kysely } from 'kysely';
import { AUDIT } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import type { ServiceCtx } from '../../lib/ctx.js';
import * as ledger from '../core/ledgerService.js';
import { record as auditRecord } from '../audit/auditService.js';
import { nextCounter } from '../core/numberingService.js';
import { NotFoundError } from '../../lib/errors.js';
import { PreconditionError } from '../../lib/ledgerErrors.js';

export type DepositLineInput = {
  line_type?: 'other_funds' | 'undeposited_funds';
  payment_id?: string | null;
  received_from?: string | null;
  account_id?: string | null;
  description?: string | null;
  payment_method?: string | null;
  ref_no?: string | null;
  amount: string;
  sort_order?: number;
};

export type CreateDepositInput = {
  bank_account_id: string;
  deposit_date: string;
  memo?: string | null;
  lines: DepositLineInput[];
  cash_back_account_id?: string | null;
  cash_back_memo?: string | null;
  cash_back_amount?: string | null;
};

/**
 * Guard to pass when voiding a deposit's JE: echo the JE's own source_type/
 * source_id back as the guard. Authorization already happened via the
 * tenant-scoped bank_deposits row lookup the caller did to get here — this
 * just satisfies voidJournalEntry's "only the owning source may void this"
 * check, which otherwise rejects deposits that wrap an AI-imported entry
 * (source_type stays 'bank_import' there; see wrapImportedDepositJournalEntry).
 * Deposits are meant to be fully editable in place regardless of origin,
 * same as QuickBooks — there is no separate read-only view.
 */
async function voidGuardFor(trx: Transaction<DB>, journal_entry_id: string) {
  const je = await trx.selectFrom('journal_entries')
    .select(['source_type', 'source_id'])
    .where('id', '=', journal_entry_id)
    .executeTakeFirst();
  return je?.source_id ? { source_guard: { source_type: je.source_type, source_id: je.source_id } } : {};
}

async function resolveBankAccount(trx: Transaction<DB>, bizId: string, bank_account_id: string) {
  const bankAccount = await trx.selectFrom('bank_accounts')
    .innerJoin('chart_of_accounts as coa', 'coa.id', 'bank_accounts.cash_account_id')
    .select(['bank_accounts.id', 'bank_accounts.cash_account_id', 'coa.name as account_name'])
    .where('bank_accounts.id', '=', bank_account_id)
    .where('bank_accounts.business_id', '=', bizId)
    .executeTakeFirst();
  if (!bankAccount) throw new NotFoundError('bank_account', bank_account_id);
  return bankAccount;
}

/** Every line needs an account, and depositing a line into the same account you're depositing to is a no-op JE line, not a real deposit. */
function validateDepositLines(lines: DepositLineInput[], bankAccount: { cash_account_id: string }) {
  for (const l of lines) {
    if (!l.account_id) throw new PreconditionError('Every deposit line must have an account');
    if (l.account_id === bankAccount.cash_account_id) {
      throw new PreconditionError('A deposit line cannot use the same account as the deposit-to bank account');
    }
  }
}

function validateDepositTotals(linesTotal: number, cashBack: number, netTotal: number) {
  // cashBack > linesTotal always implies netTotal < 0, so it must be checked
  // first — otherwise it's unreachable and callers only ever see the generic
  // "total must be greater than zero" message instead of the specific one.
  if (cashBack > linesTotal) throw new PreconditionError('Cash back cannot exceed the total of the deposit lines');
  if (netTotal <= 0) throw new PreconditionError('Deposit total must be greater than zero');
}

/** Debit the bank (net of cash back), credit every line's account, debit cash back out. Shared by create and update so the JE shape never drifts between them. */
function buildDepositJeLines(
  lines: DepositLineInput[],
  bankAccount: { cash_account_id: string },
  netTotal: number,
  cashBack: number,
  cashBackAccountId: string | null | undefined,
  cashBackMemo: string | null | undefined,
  depositMemo: string | null | undefined,
): ledger.LineInput[] {
  const jeLines: ledger.LineInput[] = [];
  for (const line of lines) {
    if (!line.account_id || parseFloat(line.amount) === 0) continue;
    jeLines.push({
      account_id: line.account_id,
      debit: '0',
      credit: parseFloat(line.amount).toFixed(2),
      memo: line.description ?? null,
    });
  }
  if (cashBackAccountId && cashBack > 0) {
    jeLines.push({
      account_id: cashBackAccountId,
      debit: cashBack.toFixed(2),
      credit: '0',
      memo: cashBackMemo ?? null,
    });
  }
  if (netTotal !== 0) {
    jeLines.push({
      account_id: bankAccount.cash_account_id,
      debit: netTotal > 0 ? netTotal.toFixed(2) : '0',
      credit: netTotal < 0 ? Math.abs(netTotal).toFixed(2) : '0',
      memo: depositMemo ?? null,
    });
  }
  return jeLines;
}

export async function createDeposit(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: CreateDepositInput,
) {
  const bizId = ctx.business_id!;

  const bankAccount = await resolveBankAccount(trx, bizId, input.bank_account_id);

  const linesTotal = input.lines.reduce((sum, l) => sum + parseFloat(l.amount), 0);
  const cashBack = parseFloat(input.cash_back_amount ?? '0') || 0;
  const netTotal = linesTotal - cashBack;
  validateDepositLines(input.lines, bankAccount);
  validateDepositTotals(linesTotal, cashBack, netTotal);

  const counter = await nextCounter(trx, bizId, 'bank_deposit');
  const deposit_number = `DEP-${String(counter).padStart(4, '0')}`;

  const deposit = await trx.insertInto('bank_deposits').values({
    business_id: bizId,
    bank_account_id: input.bank_account_id,
    deposit_date: input.deposit_date,
    deposit_number,
    memo: input.memo ?? null,
    total_amount: netTotal.toFixed(2),
    cash_back_account_id: input.cash_back_account_id ?? null,
    cash_back_memo: input.cash_back_memo ?? null,
    cash_back_amount: input.cash_back_amount ?? null,
  }).returningAll().executeTakeFirstOrThrow();

  if (input.lines.length > 0) {
    await trx.insertInto('bank_deposit_lines').values(
      input.lines.map((l, i) => ({
        deposit_id: deposit.id,
        business_id: bizId,
        line_type: (l.line_type ?? 'other_funds') as 'other_funds' | 'undeposited_funds',
        payment_id: l.payment_id ?? null,
        received_from: l.received_from ?? null,
        account_id: l.account_id ?? null,
        description: l.description ?? null,
        payment_method: l.payment_method ?? null,
        ref_no: l.ref_no ?? null,
        amount: l.amount,
        sort_order: l.sort_order ?? i,
      })),
    ).execute();
  }

  // Mark included payments as deposited
  const paymentIds = input.lines
    .filter(l => l.line_type === 'undeposited_funds' && l.payment_id)
    .map(l => l.payment_id!);
  if (paymentIds.length > 0) {
    await trx.updateTable('payments')
      .set({ is_deposited: true })
      .where('id', 'in', paymentIds)
      .where('business_id', '=', bizId)
      .execute();
  }

  const jeLines = buildDepositJeLines(
    input.lines, bankAccount, netTotal, cashBack,
    input.cash_back_account_id, input.cash_back_memo, input.memo,
  );

  let journalEntryId: string | null = null;
  if (jeLines.length >= 2) {
    const je = await ledger.postJournalEntry(trx, ctx, {
      business_id: bizId,
      entry_date: input.deposit_date,
      source_type: 'bank_deposit',
      source_id: deposit.id,
      transaction_type: 'deposit',
      memo: input.memo ?? null,
      lines: jeLines,
    });
    journalEntryId = je.id;
    await trx.updateTable('bank_deposits')
      .set({ journal_entry_id: je.id })
      .where('id', '=', deposit.id)
      .execute();
  }

  await auditRecord(trx, ctx, {
    action: AUDIT.BANK_DEPOSIT_CREATE,
    entity_type: 'bank_deposit',
    entity_id: deposit.id,
    before: null,
    after: { ...deposit, journal_entry_id: journalEntryId },
  });

  return { ...deposit, journal_entry_id: journalEntryId };
}

/**
 * Edit a posted deposit in place (same id, same deposit_number): void the old
 * JE and post a replacement. Undeposited-funds lines are fixed at creation
 * time (that set of payments was chosen when the deposit was made) — only
 * "other funds" lines, memo, date, bank account, and cash-back are editable.
 * Callers may resend the full `lines` array (as returned by getDeposit); any
 * 'undeposited_funds' entries in it are ignored in favor of what's on file.
 */
export async function updateDeposit(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  id: string,
  input: CreateDepositInput,
) {
  const bizId = ctx.business_id!;

  const before = await trx.selectFrom('bank_deposits').selectAll()
    .where('id', '=', id)
    .where('business_id', '=', bizId)
    .forUpdate()
    .executeTakeFirst();
  if (!before) throw new NotFoundError('bank_deposit', id);
  if (before.voided_at) throw new PreconditionError('A voided deposit cannot be edited');

  const existingLines = await trx.selectFrom('bank_deposit_lines').selectAll()
    .where('deposit_id', '=', id)
    .orderBy('sort_order', 'asc')
    .execute();

  const bankAccount = await resolveBankAccount(trx, bizId, input.bank_account_id);

  const keptUndeposited: DepositLineInput[] = existingLines
    .filter(l => l.line_type === 'undeposited_funds')
    .map(l => ({
      line_type: 'undeposited_funds' as const,
      payment_id: l.payment_id,
      received_from: l.received_from,
      account_id: l.account_id,
      description: l.description,
      payment_method: l.payment_method,
      ref_no: l.ref_no,
      amount: l.amount,
    }));
  const newOther = input.lines.filter(l => (l.line_type ?? 'other_funds') === 'other_funds');
  const allLines = [...keptUndeposited, ...newOther];

  validateDepositLines(allLines, bankAccount);
  const linesTotal = allLines.reduce((sum, l) => sum + parseFloat(l.amount), 0);
  const cashBack = parseFloat(input.cash_back_amount ?? '0') || 0;
  const netTotal = linesTotal - cashBack;
  validateDepositTotals(linesTotal, cashBack, netTotal);

  if (before.journal_entry_id) {
    await ledger.voidJournalEntry(trx, ctx, {
      journal_entry_id: before.journal_entry_id,
      void_reason: `Bank deposit ${before.deposit_number} edited`,
      // Reverse on the original's own date, not today — voidJournalEntry
      // defaults to today when this is omitted, which strands the reversal
      // outside any GL view bounded to the original's period and leaves the
      // voided original's full amount visibly unoffset there.
      reversal_date: before.deposit_date,
      ...(await voidGuardFor(trx, before.journal_entry_id)),
    });
  }

  await trx.deleteFrom('bank_deposit_lines')
    .where('deposit_id', '=', id)
    .where('line_type', '=', 'other_funds')
    .execute();
  if (newOther.length > 0) {
    await trx.insertInto('bank_deposit_lines').values(
      newOther.map((l, i) => ({
        deposit_id: id,
        business_id: bizId,
        line_type: 'other_funds' as const,
        payment_id: null,
        received_from: l.received_from ?? null,
        account_id: l.account_id ?? null,
        description: l.description ?? null,
        payment_method: l.payment_method ?? null,
        ref_no: l.ref_no ?? null,
        amount: l.amount,
        sort_order: keptUndeposited.length + i,
      })),
    ).execute();
  }

  const jeLines = buildDepositJeLines(
    allLines, bankAccount, netTotal, cashBack,
    input.cash_back_account_id, input.cash_back_memo, input.memo,
  );
  let journalEntryId: string | null = null;
  if (jeLines.length >= 2) {
    const je = await ledger.postJournalEntry(trx, ctx, {
      business_id: bizId,
      entry_date: input.deposit_date,
      source_type: 'bank_deposit',
      source_id: id,
      transaction_type: 'deposit',
      memo: input.memo ?? null,
      lines: jeLines,
    });
    journalEntryId = je.id;
  }

  const updated = await trx.updateTable('bank_deposits').set({
    bank_account_id: input.bank_account_id,
    deposit_date: input.deposit_date,
    memo: input.memo ?? null,
    total_amount: netTotal.toFixed(2),
    cash_back_account_id: input.cash_back_account_id ?? null,
    cash_back_memo: input.cash_back_memo ?? null,
    cash_back_amount: input.cash_back_amount ?? null,
    journal_entry_id: journalEntryId,
  }).where('id', '=', id).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.BANK_DEPOSIT_UPDATE,
    entity_type: 'bank_deposit',
    entity_id: id,
    before: { ...before, lines: existingLines },
    after: { ...updated, lines: allLines },
  });

  return { ...updated, journal_entry_id: journalEntryId };
}

export async function getDeposit(db: Kysely<DB>, ctx: ServiceCtx, id: string) {
  const deposit = await db.selectFrom('bank_deposits as d')
    .innerJoin('bank_accounts as ba', 'ba.id', 'd.bank_account_id')
    .innerJoin('chart_of_accounts as coa', 'coa.id', 'ba.cash_account_id')
    .select([
      'd.id', 'd.business_id', 'd.bank_account_id', 'd.deposit_date',
      'd.deposit_number', 'd.memo', 'd.total_amount', 'd.journal_entry_id',
      'd.cash_back_account_id', 'd.cash_back_memo', 'd.cash_back_amount',
      'd.voided_at', 'd.created_at', 'd.updated_at',
      'ba.name as bank_account_name',
      'coa.name as cash_account_name',
    ])
    .where('d.id', '=', id)
    .where('d.business_id', '=', ctx.business_id!)
    .executeTakeFirst();
  if (!deposit) throw new NotFoundError('bank_deposit', id);

  // A deposit wrapping a JE this feature didn't post itself (e.g. AI-coded
  // from a bank statement import) is flagged "Imported" only — informational,
  // same as Expense; it does not affect editability. editable instead tracks
  // the real terminal state (voided), matching Expense's own pattern.
  let imported = false;
  if (deposit.journal_entry_id) {
    const je = await db.selectFrom('journal_entries').select('source_type')
      .where('id', '=', deposit.journal_entry_id)
      .executeTakeFirst();
    imported = je !== undefined && je.source_type !== 'bank_deposit';
  }
  const editable = deposit.voided_at === null;
  const is_reconciled = await isReconciled(db, deposit.journal_entry_id);

  const lines = await db.selectFrom('bank_deposit_lines as l')
    .leftJoin('chart_of_accounts as a', 'a.id', 'l.account_id')
    .select([
      'l.id', 'l.deposit_id', 'l.line_type', 'l.payment_id',
      'l.received_from', 'l.account_id',
      'l.description', 'l.payment_method', 'l.ref_no', 'l.amount', 'l.sort_order',
      'a.name as account_name', 'a.code as account_code',
    ])
    .where('l.deposit_id', '=', id)
    .orderBy('l.sort_order', 'asc')
    .execute();

  return { ...deposit, editable, imported, is_reconciled, lines };
}

export async function listDeposits(db: Kysely<DB>, ctx: ServiceCtx) {
  return db.selectFrom('bank_deposits as d')
    .innerJoin('bank_accounts as ba', 'ba.id', 'd.bank_account_id')
    .select(eb => [
      'd.id', 'd.deposit_date', 'd.deposit_number', 'd.memo',
      'd.total_amount', 'd.bank_account_id', 'ba.name as bank_account_name',
      'd.journal_entry_id', 'd.created_at',
      // Line count + (when there's exactly one line) its received_from, so
      // the list page can show a contact for single-line deposits without a
      // second round trip per row — matches QBO leaving multi-line deposits blank.
      eb.selectFrom('bank_deposit_lines as l')
        .select(({ fn }) => fn.count<string>('l.id').as('v'))
        .whereRef('l.deposit_id', '=', 'd.id')
        .as('line_count'),
      eb.selectFrom('bank_deposit_lines as l')
        .select('l.received_from')
        .whereRef('l.deposit_id', '=', 'd.id')
        .limit(1)
        .as('first_received_from'),
    ])
    .where('d.business_id', '=', ctx.business_id!)
    .orderBy('d.deposit_date', 'desc')
    .execute();
}

/** Returns posted, non-deposited payments available to include in a deposit. */
export async function listUndepositedPayments(db: Kysely<DB>, ctx: ServiceCtx) {
  return db.selectFrom('payments as p')
    .innerJoin('customers as c', 'c.id', 'p.customer_id')
    .innerJoin('chart_of_accounts as coa', 'coa.id', 'p.cash_account_id')
    .select([
      'p.id', 'p.payment_date', 'p.payment_method', 'p.reference',
      'p.amount', 'p.memo', 'p.cash_account_id',
      'coa.name as cash_account_name', 'coa.code as cash_account_code',
      'c.id as customer_id', 'c.name as customer_name',
    ])
    .where('p.business_id', '=', ctx.business_id!)
    .where('p.is_deposited', '=', false)
    .where('p.status', '=', 'posted')
    .orderBy('p.payment_date', 'desc')
    .execute();
}

export type WrapImportedDepositInput = {
  journal_entry_id: string;
  /** chart_of_accounts id the JE's bank-side line posted to (what the import flow calls "bank_account_id"). */
  chart_account_id: string;
  offset_account_id: string;
  entry_date: string;
  description: string;
  amount: string;
};

/**
 * Give an externally-posted "deposit" journal entry (AI-coded from a bank
 * statement import, see emailImports.ts) a bank_deposits wrapper so it shows
 * up and can be viewed on the Bank Deposit page like any other deposit. Never
 * reposts or alters the JE itself — getDeposit marks a wrapped deposit
 * read-only since its real source is the import, not this feature; corrections
 * belong there. If the GL account the JE posted to was never registered as a
 * bank account (businesses that import statements without an explicit "add
 * bank account" step), one is registered here from that same account, named
 * after it — unambiguous, since it's exactly the account this deposit (and
 * every future one on it) already posts to.
 */
export async function wrapImportedDepositJournalEntry(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: WrapImportedDepositInput,
): Promise<{ id: string }> {
  const bizId = ctx.business_id!;
  let bankAccount = await trx.selectFrom('bank_accounts')
    .select(['id'])
    .where('cash_account_id', '=', input.chart_account_id)
    .where('business_id', '=', bizId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();

  if (!bankAccount) {
    const chartAccount = await trx.selectFrom('chart_of_accounts')
      .select(['name'])
      .where('id', '=', input.chart_account_id)
      .executeTakeFirstOrThrow();
    bankAccount = await trx.insertInto('bank_accounts').values({
      business_id: bizId,
      cash_account_id: input.chart_account_id,
      name: chartAccount.name,
    }).returning('id').executeTakeFirstOrThrow();
  }

  const counter = await nextCounter(trx, bizId, 'bank_deposit');
  const deposit_number = `DEP-${String(counter).padStart(4, '0')}`;

  const deposit = await trx.insertInto('bank_deposits').values({
    business_id: bizId,
    bank_account_id: bankAccount.id,
    deposit_date: input.entry_date,
    deposit_number,
    memo: input.description,
    total_amount: input.amount,
    journal_entry_id: input.journal_entry_id,
  }).returningAll().executeTakeFirstOrThrow();

  await trx.insertInto('bank_deposit_lines').values({
    deposit_id: deposit.id,
    business_id: bizId,
    line_type: 'other_funds',
    account_id: input.offset_account_id,
    description: input.description,
    amount: input.amount,
    sort_order: 0,
  }).execute();

  await auditRecord(trx, ctx, {
    action: AUDIT.BANK_DEPOSIT_CREATE,
    entity_type: 'bank_deposit',
    entity_id: deposit.id,
    before: null,
    after: deposit,
  });

  return { id: deposit.id };
}

/**
 * Void a deposit (QBO "Void"): keeps the bank_deposits record — still visible
 * and viewable, just read-only — and reverses the JE. Distinct from Delete,
 * which removes the record and the JE entirely.
 */
export async function voidDeposit(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  id: string,
) {
  const before = await trx.selectFrom('bank_deposits').selectAll()
    .where('id', '=', id)
    .where('business_id', '=', ctx.business_id!)
    .forUpdate()
    .executeTakeFirst();
  if (!before) throw new NotFoundError('bank_deposit', id);
  if (before.voided_at) throw new PreconditionError('This deposit is already void');

  if (before.journal_entry_id) {
    await ledger.voidJournalEntry(trx, ctx, {
      journal_entry_id: before.journal_entry_id,
      void_reason: `Bank deposit ${before.deposit_number} voided`,
      reversal_date: before.deposit_date,
      ...(await voidGuardFor(trx, before.journal_entry_id)),
    });
  }

  const updated = await trx.updateTable('bank_deposits').set({
    voided_at: sql`now()`,
    voided_by_user_id: ctx.user_id,
  }).where('id', '=', id).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.BANK_DEPOSIT_VOID,
    entity_type: 'bank_deposit',
    entity_id: id,
    before, after: updated,
  });
  return updated;
}

/** True once the deposit's journal entry's bank-side line has gone through a bank reconciliation. */
async function isReconciled(db: Transaction<DB> | Kysely<DB>, journal_entry_id: string | null): Promise<boolean> {
  if (!journal_entry_id) return false;
  const match = await db.selectFrom('bank_transactions')
    .select('id')
    .where('matched_journal_entry_id', '=', journal_entry_id)
    .where('is_reconciled', '=', true)
    .executeTakeFirst();
  return match !== undefined;
}

/**
 * Remove a deposit entirely (QBO "Delete"), as opposed to voidDeposit, which
 * keeps the record and reverses the JE. The JE itself is hard-deleted via
 * ledger.deleteJournalEntry — not just voided — so nothing is left in the
 * General Ledger once this returns (deleteJournalEntry also cleans up an
 * existing void's reversal pair, for a deposit that was voided first).
 */
export async function deleteDeposit(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  id: string,
) {
  const bizId = ctx.business_id!;
  const before = await trx.selectFrom('bank_deposits')
    .selectAll()
    .where('id', '=', id)
    .where('business_id', '=', bizId)
    .executeTakeFirst();
  if (!before) throw new NotFoundError('bank_deposit', id);

  if (await isReconciled(trx, before.journal_entry_id)) {
    throw new PreconditionError('This deposit has been reconciled and cannot be deleted.');
  }

  // Un-mark payments so they return to Undeposited Funds
  const paymentLines = await trx.selectFrom('bank_deposit_lines')
    .select('payment_id')
    .where('deposit_id', '=', id)
    .where('line_type', '=', 'undeposited_funds')
    .execute();
  const paymentIds = paymentLines.map(l => l.payment_id).filter(Boolean) as string[];
  if (paymentIds.length > 0) {
    await trx.updateTable('payments')
      .set({ is_deposited: false })
      .where('id', 'in', paymentIds)
      .execute();
  }

  // The journal_entry_id FK must be gone before the JE itself can be deleted,
  // so resolve the guard (reads the JE) and delete the wrapper row first.
  const guard = before.journal_entry_id ? await voidGuardFor(trx, before.journal_entry_id) : {};
  await trx.deleteFrom('bank_deposits').where('id', '=', id).execute();

  if (before.journal_entry_id) {
    await ledger.deleteJournalEntry(trx, ctx, {
      journal_entry_id: before.journal_entry_id,
      ...guard,
    });
  }

  await auditRecord(trx, ctx, {
    action: AUDIT.BANK_DEPOSIT_DELETE,
    entity_type: 'bank_deposit',
    entity_id: id,
    before,
    after: null,
  });
}
