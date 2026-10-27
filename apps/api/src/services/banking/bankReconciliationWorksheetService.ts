import { type Kysely, type Transaction, sql } from 'kysely';
import { AUDIT, addMoney, subMoney, toMoneyString, isZero, hasMinRole } from '@accounting/shared';
import type { DB, ReconciliationItemType } from '../../db/types.js';
import { NotFoundError } from '../../lib/errors.js';
import { PreconditionError } from '../../lib/ledgerErrors.js';
import { record as auditRecord } from '../audit/auditService.js';
import * as ledger from '../core/ledgerService.js';
import * as expenseSvc from '../ap/expenseTransactionService.js';
import * as depositSvc from './bankDepositService.js';
import { getOrCreateOpeningBalanceEquity } from '../core/chartOfAccountsService.js';
import type { ServiceCtx } from '../../lib/ctx.js';
import { isInflow, statementDateToIso, type StatementLine } from '../ai/statementImportService.js';
import {
  matchStatementLines, matchStatementLinesDetailed,
  type MatchCandidateItem, type MatchDetail, type MatchStatementLine,
} from './reconciliationAutoMatch.js';

export type StartReconciliationInput = {
  account_id: string;
  statement_ending_balance: string;
  statement_ending_date: string;
  service_charge_amount?: string | null;
  service_charge_date?: string | null;
  service_charge_account_id?: string | null;
  interest_earned_amount?: string | null;
  interest_earned_date?: string | null;
  interest_earned_account_id?: string | null;
};

export type WorksheetItem = {
  transaction_type: ReconciliationItemType;
  transaction_id: string;
  transaction_date: string;
  type_label: string;
  ref_no: string | null;
  name: string | null;
  description: string | null;
  /** Signed: positive is a deposit (money in), negative is a payment (money out). */
  amount: string;
  is_cleared: boolean;
  /** Pre-ticked by matching against an uploaded bank statement at Start, not by the user. */
  auto_matched: boolean;
  transaction_path: string;
};

/**
 * The category QuickBooks' own reconcile picker groups an account under.
 * Bank wins over everything else once a bank_accounts row backs the account
 * (that's the authoritative signal, not detail_type — a Checking-labelled
 * account nobody registered as a bank account still reconciles as whichever
 * of the other seven categories its own type/detail type says it is).
 */
const BANK_DETAIL_TYPES = new Set(['Cash on Hand', 'Cash on hand', 'Checking', 'Money Market', 'Rents Held in Trust', 'Savings', 'Trust account']);
const CREDIT_CARD_DETAIL_TYPES = new Set(['Credit Card']);
const FIXED_ASSET_DETAIL_TYPES = new Set([
  'Buildings', 'Depletable Assets', 'Fixed Asset Computers', 'Fixed Asset Copiers', 'Fixed Asset Furniture',
  'Fixed Asset Other Tools Equipment', 'Fixed Asset Phone', 'Fixed Asset Photo Video', 'Fixed Asset Software',
  'Furniture & Fixtures', 'Intangible Assets', 'Land', 'Leasehold Improvements', 'Machinery & Equipment',
  'Other fixed assets', 'Vehicles', 'Fixed Assets',
]);
const OTHER_ASSET_DETAIL_TYPES = new Set([
  'Goodwill', 'Lease Buyout', 'Licenses', 'Organizational Costs', 'Other Long-term Assets', 'Security Deposits', 'Other Assets',
]);
const LONG_TERM_LIABILITY_DETAIL_TYPES = new Set(['Notes Payable', 'Other Long Term Liabilities', 'Shareholder Notes Payable']);

export type ReconcilableCategory =
  | 'Bank' | 'Credit Card' | 'Other Current Asset' | 'Fixed Asset' | 'Other Asset'
  | 'Other Current Liability' | 'Long-Term Liability' | 'Equity';

export function reconcilableCategory(
  account: { account_type: string; detail_type: string | null }, hasBankRow: boolean,
): ReconcilableCategory {
  if (hasBankRow) return 'Bank';
  const detail = account.detail_type;
  if (account.account_type === 'equity') return 'Equity';
  if (account.account_type === 'asset') {
    if (detail && BANK_DETAIL_TYPES.has(detail)) return 'Bank';
    if (detail && FIXED_ASSET_DETAIL_TYPES.has(detail)) return 'Fixed Asset';
    if (detail && OTHER_ASSET_DETAIL_TYPES.has(detail)) return 'Other Asset';
    return 'Other Current Asset';
  }
  // liability
  if (detail && CREDIT_CARD_DETAIL_TYPES.has(detail)) return 'Credit Card';
  if (detail && LONG_TERM_LIABILITY_DETAIL_TYPES.has(detail)) return 'Long-Term Liability';
  return 'Other Current Liability';
}

/** Every account the Reconcile picker offers: active asset/liability/equity
 * accounts, not just ones registered as a bank account. */
export async function listReconcilableAccounts(db: Kysely<DB>, ctx: ServiceCtx) {
  const bizId = ctx.business_id!;
  const accounts = await db.selectFrom('chart_of_accounts')
    .select(['id', 'code', 'name', 'account_type', 'detail_type'])
    .where('business_id', '=', bizId)
    .where('is_active', '=', true)
    .where('account_type', 'in', ['asset', 'liability', 'equity'])
    .where('system_key', 'is', null)
    .orderBy('code')
    .execute();
  const bankRows = await db.selectFrom('bank_accounts').select('cash_account_id')
    .where('business_id', '=', bizId).where('deleted_at', 'is', null).execute();
  const bankSet = new Set(bankRows.map(r => r.cash_account_id));
  return accounts.map(a => ({
    id: a.id, code: a.code, name: a.name,
    category: reconcilableCategory(a, bankSet.has(a.id)),
  }));
}

async function resolveAccount(db: Kysely<DB> | Transaction<DB>, business_id: string, id: string) {
  const row = await db.selectFrom('chart_of_accounts').selectAll()
    .where('id', '=', id).where('business_id', '=', business_id).executeTakeFirst();
  if (!row || !row.is_active) throw new NotFoundError('chart_of_accounts', id);
  if (row.account_type !== 'asset' && row.account_type !== 'liability' && row.account_type !== 'equity') {
    throw new PreconditionError('Only an asset, liability or equity account can be reconciled');
  }
  return row;
}

/** The bank_accounts row backing this account, if the account was registered
 * as one — deposits and checks only exist for a registered bank account. */
async function bankAccountFor(db: Kysely<DB> | Transaction<DB>, business_id: string, account_id: string) {
  return db.selectFrom('bank_accounts').selectAll()
    .where('cash_account_id', '=', account_id).where('business_id', '=', business_id).where('deleted_at', 'is', null)
    .executeTakeFirst();
}

/** The prior completed reconciliation's statement ending balance, or 0 for the first one. */
async function computeBeginningBalance(db: Kysely<DB> | Transaction<DB>, account_id: string): Promise<string> {
  const prior = await db.selectFrom('reconciliations').select('statement_ending_balance')
    .where('account_id', '=', account_id)
    .where('status', '=', 'completed')
    .orderBy('statement_ending_date', 'desc')
    .executeTakeFirst();
  return prior ? toMoneyString(prior.statement_ending_balance) : '0.00';
}

/** What the Setup page needs before it can offer "Start reconciling": the
 * carried-forward beginning balance, and whether one is already in progress
 * (so the page offers "Resume" instead of letting a second one collide with it). */
export async function getStatus(db: Kysely<DB>, ctx: ServiceCtx, account_id: string) {
  await resolveAccount(db, ctx.business_id!, account_id);
  const inProgress = await db.selectFrom('reconciliations').select('id')
    .where('account_id', '=', account_id).where('status', '=', 'in_progress')
    .executeTakeFirst();
  return {
    beginning_balance: await computeBeginningBalance(db, account_id),
    in_progress_id: inProgress?.id ?? null,
  };
}

function calendarDaysBetween(aIso: string, bIso: string): number {
  return Math.abs(Date.parse(`${aIso}T00:00:00Z`) - Date.parse(`${bIso}T00:00:00Z`)) / 86_400_000;
}

/**
 * The reviewed bank statement (if any) that belongs to this reconciliation's
 * account and period — item 71/72, 2026-10-16 follow-ups. An uploaded
 * statement has no account_id of its own (email_import_staging only carries a
 * free-text account_hint, often blank in practice), so this resolves it the
 * same way a person would: only an already-approved bank statement counts (an
 * unreviewed AI extraction shouldn't silently drive auto-ticking); its own
 * latest line has to fall within 10 days of this statement's ending date
 * (banks' last line rarely lands exactly on the period's close); and if more
 * than one approved statement clears that bar, account_hint has to narrow it
 * down to exactly one, or this returns null and the worksheet opens fully
 * manual — never guessing which account a statement belongs to.
 */
export type MatchingStatement = {
  stagingId: string;
  periodStart: string | null;
  periodEnd: string | null;
  openingBalance: string | null;
  closingBalance: string | null;
  lines: StatementLine[];
};

async function resolveMatchingStatement(
  db: Kysely<DB> | Transaction<DB>, bizId: string,
  account: { name: string }, bankRow: { name: string; institution: string | null } | undefined,
  statementEndingDate: string,
): Promise<MatchingStatement | null> {
  const staged = await db.selectFrom('email_import_staging')
    .select(['id', 'account_hint', 'extracted_transactions', 'period_start', 'period_end', 'beginning_balance', 'ending_balance'])
    .where('business_id', '=', bizId)
    .where('statement_kind', '=', 'bank')
    .where('status', '=', 'approved')
    .execute();
  if (staged.length === 0) return null;

  const candidates: { stagingId: string; account_hint: string | null; lines: StatementLine[]; periodStart: string | null; periodEnd: string | null; openingBalance: string | null; closingBalance: string | null }[] = [];
  for (const s of staged) {
    let lines: StatementLine[] = [];
    try {
      const raw = s.extracted_transactions;
      const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
      lines = Array.isArray(parsed) ? (parsed as StatementLine[]) : [];
    } catch { continue; }
    if (lines.length === 0) continue;
    const isoDates = lines.map(l => statementDateToIso(l.date)).sort();
    const maxDate = isoDates[isoDates.length - 1]!;
    if (calendarDaysBetween(maxDate, statementEndingDate) > 10) continue;
    candidates.push({
      stagingId: s.id, account_hint: s.account_hint, lines,
      periodStart: s.period_start as string | null, periodEnd: s.period_end as string | null,
      openingBalance: s.beginning_balance === null ? null : toMoneyString(s.beginning_balance),
      closingBalance: s.ending_balance === null ? null : toMoneyString(s.ending_balance),
    });
  }
  if (candidates.length === 0) return null;

  const toResult = (c: (typeof candidates)[number]): MatchingStatement => ({
    stagingId: c.stagingId, periodStart: c.periodStart, periodEnd: c.periodEnd,
    openingBalance: c.openingBalance, closingBalance: c.closingBalance, lines: c.lines,
  });
  if (candidates.length === 1) return toResult(candidates[0]!);

  const hintTargets = [bankRow?.name, bankRow?.institution, account.name]
    .filter((v): v is string => !!v).map(v => v.toLowerCase());
  const byHint = candidates.filter(c => c.account_hint
    && hintTargets.some(t => c.account_hint!.toLowerCase().includes(t) || t.includes(c.account_hint!.toLowerCase())));
  return byHint.length === 1 ? toResult(byHint[0]!) : null;
}

/** The candidate ledger items a statement line could account for: everything
 * not already ticked some other way (service charge, interest, a bank-feed
 * match) — those stay as they are, untouched by statement matching. */
/**
 * `recompute: true` (getStatementMatch only) treats an item that's cleared
 * *only* because a prior run of this same statement-matching already
 * claimed it (`auto_matched`) as still available — otherwise a line that
 * matched at Start could never be rediscovered on a later call, since its
 * own earlier match would look identical to "already accounted for some
 * other way" (a service charge, interest, a bank-feed match) and get
 * filtered out before matching even runs. An item cleared by one of those
 * other means (auto_matched false) still stays off-limits either way.
 */
function matchCandidatesFrom(items: WorksheetItem[], opts: { recompute?: boolean } = {}): MatchCandidateItem[] {
  return items.map(i => ({
    key: `${i.transaction_type}:${i.transaction_id}`,
    transaction_date: i.transaction_date,
    amount: i.amount,
    name: i.name,
    description: i.description,
    ref_no: i.ref_no,
    already_cleared: opts.recompute ? (i.is_cleared && !i.auto_matched) : i.is_cleared,
  }));
}

function matchLinesFrom(statementLines: StatementLine[]): MatchStatementLine[] {
  return statementLines.map(l => ({
    date: statementDateToIso(l.date),
    amount: l.amount,
    description: l.description,
    ...(l.payee_name !== undefined ? { payee_name: l.payee_name } : {}),
    isInflow: isInflow(l),
    ...(l.check_number !== undefined ? { checkNumber: l.check_number } : {}),
  }));
}

export async function startReconciliation(
  trx: Transaction<DB>, ctx: ServiceCtx, input: StartReconciliationInput,
) {
  const bizId = ctx.business_id!;
  const account = await resolveAccount(trx, bizId, input.account_id);
  const bankRow = await bankAccountFor(trx, bizId, account.id);

  const inProgress = await trx.selectFrom('reconciliations').select('id')
    .where('account_id', '=', input.account_id).where('status', '=', 'in_progress')
    .executeTakeFirst();
  if (inProgress) {
    throw new PreconditionError('A reconciliation is already in progress for this account. Finish or cancel it first.', { reconciliation_id: inProgress.id });
  }

  const beginningBalance = await computeBeginningBalance(trx, input.account_id);

  const recon = await trx.insertInto('reconciliations').values({
    business_id: bizId,
    account_id: input.account_id,
    statement_beginning_balance: beginningBalance,
    statement_ending_balance: input.statement_ending_balance,
    statement_ending_date: input.statement_ending_date,
    beginning_balance: beginningBalance,
    service_charge_amount: input.service_charge_amount ?? '0',
    service_charge_date: input.service_charge_date ?? null,
    service_charge_account_id: input.service_charge_account_id ?? null,
    interest_earned_amount: input.interest_earned_amount ?? '0',
    interest_earned_date: input.interest_earned_date ?? null,
    interest_earned_account_id: input.interest_earned_account_id ?? null,
    status: 'in_progress',
    created_by_user_id: ctx.user_id,
  }).returningAll().executeTakeFirstOrThrow();

  // A service charge or interest amount creates a real, postable transaction
  // (through the normal expense / deposit / ledger service, so it gets the
  // same ledger posting, audit trail and void/delete guards as anything
  // else) so it shows up in the worksheet to be cleared, pre-checked since it
  // exists only to account for this statement's own fee or interest line.
  const serviceChargeAmount = parseFloat(input.service_charge_amount ?? '0') || 0;
  if (serviceChargeAmount > 0) {
    if (!input.service_charge_account_id) throw new PreconditionError('An expense account is required for the service charge');
    const expense = await expenseSvc.createExpense(trx, ctx, {
      transaction_date: input.service_charge_date ?? input.statement_ending_date,
      payee_text: account.name,
      payment_account_id: account.id,
      payment_method: 'other',
      memo: `Service charge — reconciling ${account.name} through ${input.statement_ending_date}`,
      lines: [{ category_account_id: input.service_charge_account_id, amount: serviceChargeAmount.toFixed(2) }],
    });
    await trx.insertInto('reconciliation_items').values({
      reconciliation_id: recon.id,
      transaction_type: 'service_charge',
      transaction_id: expense.id,
      transaction_date: expense.transaction_date,
      description: 'Service charge',
      amount: (-serviceChargeAmount).toFixed(2),
      is_cleared: true,
      cleared_at: sql`now()`,
    }).execute();
  }

  const interestAmount = parseFloat(input.interest_earned_amount ?? '0') || 0;
  if (interestAmount > 0) {
    if (!input.interest_earned_account_id) throw new PreconditionError('An income account is required for interest earned');
    if (bankRow) {
      const deposit = await depositSvc.createDeposit(trx, ctx, {
        bank_account_id: bankRow.id,
        deposit_date: input.interest_earned_date ?? input.statement_ending_date,
        memo: `Interest earned — reconciling ${account.name} through ${input.statement_ending_date}`,
        lines: [{
          line_type: 'other_funds',
          account_id: input.interest_earned_account_id,
          description: 'Interest earned',
          amount: interestAmount.toFixed(2),
        }],
      });
      await trx.insertInto('reconciliation_items').values({
        reconciliation_id: recon.id,
        transaction_type: 'interest',
        transaction_id: deposit.id,
        transaction_date: deposit.deposit_date,
        description: 'Interest earned',
        amount: interestAmount.toFixed(2),
        is_cleared: true,
        cleared_at: sql`now()`,
      }).execute();
    } else {
      // Not a registered bank account (e.g. a credit card or other balance-
      // sheet account) — bank_deposits requires one, so this posts as a plain
      // journal entry instead.
      const je = await ledger.postJournalEntry(trx, ctx, {
        business_id: bizId,
        entry_date: input.interest_earned_date ?? input.statement_ending_date,
        source_type: 'manual',
        transaction_type: 'journal_entry',
        memo: `Interest earned — reconciling ${account.name} through ${input.statement_ending_date}`,
        reference: null,
        lines: [
          { account_id: account.id, debit: interestAmount.toFixed(2), credit: '0', memo: 'Interest earned' },
          { account_id: input.interest_earned_account_id, debit: '0', credit: interestAmount.toFixed(2), memo: 'Interest earned' },
        ],
      });
      await trx.insertInto('reconciliation_items').values({
        reconciliation_id: recon.id,
        transaction_type: 'interest',
        transaction_id: je.id,
        transaction_date: je.entry_date,
        description: 'Interest earned',
        amount: interestAmount.toFixed(2),
        is_cleared: true,
        cleared_at: sql`now()`,
      }).execute();
    }
  }

  // Item 71: compare the account's candidate lines against an already-uploaded,
  // approved bank statement for this period, and pre-tick whatever matches —
  // once, here at Start, not on every later worksheet load (see
  // reconciliationAutoMatch.ts for the actual matching rules). No statement
  // for this account/period simply means no auto-ticks; the worksheet still
  // opens, fully manual, same as it always has.
  const matchingStatement = await resolveMatchingStatement(trx, bizId, account, bankRow, input.statement_ending_date);
  let autoMatchedCount = 0;
  if (matchingStatement && matchingStatement.lines.length > 0) {
    const worksheetSoFar = await getWorksheet(trx as unknown as Kysely<DB>, ctx, recon.id);
    const candidateItems = matchCandidatesFrom(worksheetSoFar.items);
    const matchLines = matchLinesFrom(matchingStatement.lines);
    const matchedKeys = matchStatementLines(candidateItems, matchLines);
    const byKey = new Map(worksheetSoFar.items.map(i => [`${i.transaction_type}:${i.transaction_id}`, i]));
    for (const key of matchedKeys) {
      const item = byKey.get(key);
      if (!item) continue;
      await trx.insertInto('reconciliation_items').values({
        reconciliation_id: recon.id,
        transaction_type: item.transaction_type,
        transaction_id: item.transaction_id,
        transaction_date: item.transaction_date,
        description: item.description,
        amount: item.amount,
        is_cleared: true,
        auto_matched: true,
        cleared_at: sql`now()`,
      }).onConflict(oc => oc.columns(['reconciliation_id', 'transaction_type', 'transaction_id']).doUpdateSet({
        is_cleared: true, auto_matched: true, cleared_at: sql`now()`,
      })).execute();
    }
    autoMatchedCount = matchedKeys.size;
  }

  await auditRecord(trx, ctx, {
    action: AUDIT.BANK_RECONCILIATION_START,
    entity_type: 'reconciliation',
    entity_id: recon.id,
    before: null,
    after: { ...recon, auto_matched_count: autoMatchedCount },
  });

  return recon;
}

/** Which of these journal entries was matched through the bank-feed inbox and
 * swept into a bulk review-lock — pre-check those rows the same way the old
 * bank_transactions-based reconciliation did. One query for every candidate
 * instead of one per row: a worksheet with a year of history was running
 * hundreds of these sequentially (see item 75, 2026-10-16 follow-ups). */
async function bankFeedMatchedIds(db: Kysely<DB> | Transaction<DB>, journalEntryIds: string[]): Promise<Set<string>> {
  if (journalEntryIds.length === 0) return new Set();
  const rows = await db.selectFrom('bank_transactions').select('matched_journal_entry_id')
    .where('matched_journal_entry_id', 'in', journalEntryIds)
    .where('status', 'in', ['matched', 'categorized'])
    .execute();
  return new Set(rows.map(r => r.matched_journal_entry_id).filter((v): v is string => v !== null));
}

type SavedState = { is_cleared: boolean; auto_matched: boolean };

async function savedClearedState(db: Kysely<DB> | Transaction<DB>, reconciliation_id: string) {
  const rows = await db.selectFrom('reconciliation_items')
    .select(['transaction_type', 'transaction_id', 'is_cleared', 'auto_matched'])
    .where('reconciliation_id', '=', reconciliation_id)
    .execute();
  const map = new Map<string, SavedState>();
  for (const r of rows) map.set(`${r.transaction_type}:${r.transaction_id}`, { is_cleared: r.is_cleared, auto_matched: r.auto_matched });
  return map;
}

export async function getWorksheet(db: Kysely<DB>, ctx: ServiceCtx, id: string) {
  const bizId = ctx.business_id!;
  const recon = await db.selectFrom('reconciliations').selectAll()
    .where('id', '=', id).where('business_id', '=', bizId).executeTakeFirst();
  if (!recon) throw new NotFoundError('reconciliation', id);
  const account = await resolveAccount(db, bizId, recon.account_id);
  const bankRow = await bankAccountFor(db, bizId, account.id);
  const saved = await savedClearedState(db, id);

  const items: WorksheetItem[] = [];
  const wrappedJeIds = new Set<string>();

  const deposits = bankRow
    ? await db.selectFrom('bank_deposits')
      .select(['id', 'deposit_date', 'deposit_number', 'memo', 'total_amount', 'journal_entry_id'])
      .where('bank_account_id', '=', bankRow.id)
      .where('voided_at', 'is', null)
      .where('reconciliation_status', '!=', 'reconciled')
      .where('deposit_date', '<=', recon.statement_ending_date)
      .execute()
    : [];
  const checks = bankRow
    ? await db.selectFrom('checks as c')
      .leftJoin('vendors as v', 'v.id', 'c.payee_id')
      .select(['c.id', 'c.payment_date', 'c.check_number', 'c.payee_text', 'v.name as vendor_name', 'c.memo', 'c.total_amount', 'c.journal_entry_id'])
      .where('c.bank_account_id', '=', bankRow.id)
      .where('c.status', '=', 'posted')
      .where('c.reconciliation_status', '!=', 'reconciled')
      .where('c.payment_date', '<=', recon.statement_ending_date)
      .execute()
    : [];

  // Expenses paid from this account — works for any asset/liability payment
  // account (e.g. a credit card purchase), not only a registered bank account.
  // A charge credits the payment account, which increases a liability's own
  // balance (what's owed) the opposite way it decreases an asset's (cash on hand).
  const debitNormal = account.account_type === 'asset';
  const expenses = await db.selectFrom('expense_transactions as e')
    .leftJoin('vendors as v', 'v.id', 'e.vendor_id')
    .select(['e.id', 'e.transaction_date', 'e.reference', 'e.payee_text', 'v.name as vendor_name', 'e.memo', 'e.total_amount', 'e.journal_entry_id', 'e.payment_method'])
    .where('e.payment_account_id', '=', account.id)
    .where('e.status', '=', 'posted')
    .where('e.reconciliation_status', '!=', 'reconciled')
    .where('e.transaction_date', '<=', recon.statement_ending_date)
    .execute();

  // One batched lookup for every candidate's bank-feed-matched state, instead
  // of one query per row (see item 75, 2026-10-16 follow-ups — this is what
  // made the worksheet "stay in progress for a long time" on an account with
  // real history).
  const candidateJeIds = [
    ...deposits.map(d => d.journal_entry_id),
    ...checks.map(c => c.journal_entry_id),
    ...expenses.map(e => e.journal_entry_id),
  ].filter((v): v is string => v !== null);
  const matchedJeIds = await bankFeedMatchedIds(db, candidateJeIds);

  for (const d of deposits) {
    if (d.journal_entry_id) wrappedJeIds.add(d.journal_entry_id);
    // Interest earned, created at Start, is a bank_deposits row under the hood —
    // its cleared state was saved under the 'interest' item type, not 'deposit'.
    const isInterest = saved.has(`interest:${d.id}`);
    const type: ReconciliationItemType = isInterest ? 'interest' : 'deposit';
    const key = `${type}:${d.id}`;
    const savedEntry = saved.get(key);
    items.push({
      transaction_type: type, transaction_id: d.id, transaction_date: d.deposit_date,
      type_label: isInterest ? 'Interest Earned' : 'Deposit', ref_no: d.deposit_number, name: null, description: d.memo,
      amount: toMoneyString(d.total_amount),
      is_cleared: savedEntry?.is_cleared ?? (d.journal_entry_id !== null && matchedJeIds.has(d.journal_entry_id)),
      auto_matched: savedEntry?.auto_matched ?? false,
      transaction_path: `/accounting/deposits/${d.id}`,
    });
  }

  for (const c of checks) {
    if (c.journal_entry_id) wrappedJeIds.add(c.journal_entry_id);
    const key = `check:${c.id}`;
    const savedEntry = saved.get(key);
    items.push({
      transaction_type: 'check', transaction_id: c.id, transaction_date: c.payment_date,
      type_label: 'Check', ref_no: c.check_number, name: c.vendor_name ?? c.payee_text, description: c.memo,
      amount: toMoneyString(`-${c.total_amount}`),
      is_cleared: savedEntry?.is_cleared ?? (c.journal_entry_id !== null && matchedJeIds.has(c.journal_entry_id)),
      auto_matched: savedEntry?.auto_matched ?? false,
      transaction_path: `/accounting/checks/${c.id}`,
    });
  }

  const expenseJeIds = new Set<string>();
  for (const e of expenses) {
    if (e.journal_entry_id) expenseJeIds.add(e.journal_entry_id);
    const isServiceCharge = saved.has(`service_charge:${e.id}`);
    const type: ReconciliationItemType = isServiceCharge ? 'service_charge' : 'expense';
    const key = `${type}:${e.id}`;
    const savedEntry = saved.get(key);
    const isCheck = e.payment_method === 'check';
    items.push({
      transaction_type: type, transaction_id: e.id, transaction_date: e.transaction_date,
      type_label: isServiceCharge ? 'Service Charge' : (isCheck ? 'Check' : 'Expense'), ref_no: e.reference, name: e.vendor_name ?? e.payee_text, description: e.memo,
      amount: toMoneyString(`${debitNormal ? '-' : ''}${e.total_amount}`),
      is_cleared: savedEntry?.is_cleared ?? (e.journal_entry_id !== null && matchedJeIds.has(e.journal_entry_id)),
      auto_matched: savedEntry?.auto_matched ?? false,
      transaction_path: `/accounting/expenses/${e.id}`,
    });
  }

  // Any other posted entry that touches this account directly: hand-entered
  // manual/adjusting entries, and — for a non-bank account like a credit card —
  // the category-side line of a payment made FROM a different account (e.g. a
  // bank-paid expense categorized to this card, which pays it down). Excludes
  // journal entries already covered above through their own wrapper, so the
  // same money is never listed twice.
  const coveredJeIds = new Set<string>([...wrappedJeIds, ...expenseJeIds]);
  const jeLinesQuery = db.selectFrom('journal_entries as j')
    .innerJoin('journal_entry_lines as l', 'l.journal_entry_id', 'j.id')
    .select(['j.id', 'j.entry_date', 'j.journal_number', 'j.reference', 'j.payee_name', 'j.memo', 'l.debit', 'l.credit'])
    .where('l.account_id', '=', account.id)
    .where('j.status', '=', 'posted')
    .where('j.source_type', '!=', 'reconciliation_adjustment')
    .where('j.reconciliation_status', '!=', 'reconciled')
    .where('j.entry_date', '<=', recon.statement_ending_date);
  const jeLines = (coveredJeIds.size > 0
    ? await jeLinesQuery.where('j.id', 'not in', [...coveredJeIds]).execute()
    : await jeLinesQuery.execute());
  for (const j of jeLines) {
    // Interest earned on an account with no bank_accounts row posts as a
    // plain JE — surface it as 'Interest Earned' the same as a deposit would.
    const isInterest = saved.has(`interest:${j.id}`);
    const type: ReconciliationItemType = isInterest ? 'interest' : 'journal_entry';
    const key = `${type}:${j.id}`;
    const savedEntry = saved.get(key);
    const amount = toMoneyString(debitNormal ? subMoney(toMoneyString(j.debit), toMoneyString(j.credit)) : subMoney(toMoneyString(j.credit), toMoneyString(j.debit)));
    if (isZero(amount)) continue;
    items.push({
      transaction_type: type, transaction_id: j.id, transaction_date: j.entry_date,
      type_label: isInterest ? 'Interest Earned' : 'Journal Entry', ref_no: j.reference ?? j.journal_number, name: j.payee_name, description: j.memo,
      amount,
      is_cleared: savedEntry?.is_cleared ?? false,
      auto_matched: savedEntry?.auto_matched ?? false,
      transaction_path: `/accounting/journal-entries/${j.id}`,
    });
  }

  items.sort((a, b) => a.transaction_date.localeCompare(b.transaction_date));

  let clearedBalance = toMoneyString(recon.beginning_balance);
  let clearedCount = 0;
  let autoMatchedCount = 0;
  for (const item of items) {
    if (item.is_cleared) {
      clearedBalance = toMoneyString(addMoney(clearedBalance, item.amount));
      clearedCount++;
    }
    if (item.auto_matched) autoMatchedCount++;
  }
  const difference = toMoneyString(subMoney(toMoneyString(recon.statement_ending_balance), clearedBalance));

  return {
    reconciliation: recon,
    account,
    category: reconcilableCategory(account, !!bankRow),
    items,
    summary: {
      statement_beginning_balance: toMoneyString(recon.beginning_balance),
      statement_ending_balance: toMoneyString(recon.statement_ending_balance),
      cleared_balance: clearedBalance,
      difference,
      cleared_count: clearedCount,
      total_count: items.length,
      auto_matched_count: autoMatchedCount,
    },
  };
}

export type StatementMatchLine = {
  lineIndex: number;
  date: string;
  description: string;
  payeeName: string | null;
  /** Signed, same convention as WorksheetItem.amount: deposit positive, outflow negative. */
  amount: string;
  checkNumber: string | null;
  matched: {
    transaction_type: ReconciliationItemType;
    transaction_id: string;
    transaction_date: string;
    name: string | null;
    description: string | null;
    amount: string;
    /** Whether it's currently ticked — a match the user has since rejected
     * (unchecked in the worksheet) still shows here as the detected pairing,
     * just not confirmed. */
    is_cleared: boolean;
  } | null;
  reason: MatchDetail['reason'];
  confidence: number | null;
};

/**
 * The statement-side view the plain worksheet never had: every line of the
 * bank statement matched against this reconciliation's period, not just
 * which book rows got pre-ticked. Recomputed fresh on every call against the
 * worksheet's current cleared state — nothing new is persisted — so a
 * rejected match (unticked in the worksheet) simply stops showing as matched
 * here next time, and a manually-ticked item becomes ineligible for a
 * *different* statement line the same way auto-matching already respects
 * `already_cleared`. Returns null when no approved statement resolves to
 * this reconciliation's account/period (see resolveMatchingStatement) — the
 * worksheet still works fully manually in that case, same as always.
 */
export async function getStatementMatch(db: Kysely<DB>, ctx: ServiceCtx, id: string): Promise<{
  statementId: string;
  periodStart: string | null;
  periodEnd: string | null;
  openingBalance: string | null;
  closingBalance: string | null;
  lines: StatementMatchLine[];
} | null> {
  const bizId = ctx.business_id!;
  const recon = await db.selectFrom('reconciliations').selectAll()
    .where('id', '=', id).where('business_id', '=', bizId).executeTakeFirst();
  if (!recon) throw new NotFoundError('reconciliation', id);
  const account = await resolveAccount(db, bizId, recon.account_id);
  const bankRow = await bankAccountFor(db, bizId, account.id);

  const matchingStatement = await resolveMatchingStatement(db, bizId, account, bankRow, recon.statement_ending_date);
  if (!matchingStatement) return null;

  const { items } = await getWorksheet(db, ctx, id);
  const candidateItems = matchCandidatesFrom(items, { recompute: true });
  const matchLines = matchLinesFrom(matchingStatement.lines);
  const detail = matchStatementLinesDetailed(candidateItems, matchLines);
  const itemByKey = new Map(items.map(i => [`${i.transaction_type}:${i.transaction_id}`, i]));

  const lines: StatementMatchLine[] = matchingStatement.lines.map((l, lineIndex) => {
    const d = detail[lineIndex]!;
    const matchedItem = d.matchedKey ? itemByKey.get(d.matchedKey) : undefined;
    return {
      lineIndex,
      date: statementDateToIso(l.date),
      description: l.description,
      payeeName: l.payee_name ?? null,
      amount: toMoneyString(isInflow(l) ? l.amount : `-${l.amount}`),
      checkNumber: l.check_number ?? null,
      matched: matchedItem ? {
        transaction_type: matchedItem.transaction_type,
        transaction_id: matchedItem.transaction_id,
        transaction_date: matchedItem.transaction_date,
        name: matchedItem.name,
        description: matchedItem.description,
        amount: matchedItem.amount,
        is_cleared: matchedItem.is_cleared,
      } : null,
      reason: d.reason,
      confidence: d.confidence,
    };
  });

  return {
    statementId: matchingStatement.stagingId,
    periodStart: matchingStatement.periodStart,
    periodEnd: matchingStatement.periodEnd,
    openingBalance: matchingStatement.openingBalance,
    closingBalance: matchingStatement.closingBalance,
    lines,
  };
}

export async function saveProgress(
  trx: Transaction<DB>, ctx: ServiceCtx,
  id: string,
  inputItems: { transaction_type: ReconciliationItemType; transaction_id: string; is_cleared: boolean }[],
) {
  const bizId = ctx.business_id!;
  const recon = await trx.selectFrom('reconciliations').selectAll()
    .where('id', '=', id).where('business_id', '=', bizId).forUpdate().executeTakeFirst();
  if (!recon) throw new NotFoundError('reconciliation', id);
  if (recon.status !== 'in_progress') throw new PreconditionError('This reconciliation is no longer in progress');

  // getWorksheet needs the live transaction_date/amount for each row, so read
  // it fresh rather than trust the client — only is_cleared is taken from input.
  const { items: liveItems } = await getWorksheet(trx as unknown as Kysely<DB>, ctx, id);
  const liveByKey = new Map(liveItems.map(i => [`${i.transaction_type}:${i.transaction_id}`, i]));
  const clearedByKey = new Map(liveItems.map(i => [`${i.transaction_type}:${i.transaction_id}`, i.is_cleared]));

  for (const input of inputItems) {
    const live = liveByKey.get(`${input.transaction_type}:${input.transaction_id}`);
    if (!live) continue;
    clearedByKey.set(`${input.transaction_type}:${input.transaction_id}`, input.is_cleared);
    await trx.insertInto('reconciliation_items').values({
      reconciliation_id: id,
      transaction_type: input.transaction_type,
      transaction_id: input.transaction_id,
      transaction_date: live.transaction_date,
      description: live.description,
      amount: live.amount,
      is_cleared: input.is_cleared,
      cleared_at: input.is_cleared ? sql`now()` : null,
    }).onConflict(oc => oc.columns(['reconciliation_id', 'transaction_type', 'transaction_id']).doUpdateSet({
      is_cleared: input.is_cleared,
      cleared_at: input.is_cleared ? sql`now()` : null,
    })).execute();
  }

  // The just-written cleared state fully determines the new difference —
  // recomputing it from `liveItems` + what was just upserted avoids a second
  // full getWorksheet() (another three-table scan) just to read it back.
  let clearedBalance = toMoneyString(recon.beginning_balance);
  for (const i of liveItems) {
    if (clearedByKey.get(`${i.transaction_type}:${i.transaction_id}`)) {
      clearedBalance = toMoneyString(addMoney(clearedBalance, i.amount));
    }
  }
  const difference = toMoneyString(subMoney(toMoneyString(recon.statement_ending_balance), clearedBalance));
  const summary = {
    statement_beginning_balance: toMoneyString(recon.beginning_balance),
    statement_ending_balance: toMoneyString(recon.statement_ending_balance),
    cleared_balance: clearedBalance,
    difference,
    cleared_count: [...clearedByKey.values()].filter(Boolean).length,
    total_count: liveItems.length,
    auto_matched_count: liveItems.filter(i => i.auto_matched).length,
  };

  const updated = await trx.updateTable('reconciliations')
    .set({ difference: summary.difference })
    .where('id', '=', id).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.BANK_RECONCILIATION_SAVE,
    entity_type: 'reconciliation',
    entity_id: id,
    before: { difference: recon.difference },
    after: { difference: updated.difference },
  });

  return { reconciliation: updated, summary };
}

/** Which table a reconciliation item's own row lives in. 'check' and
 * 'journal_entry' are fixed; 'expense'/'service_charge' are always an
 * expense_transactions row (createExpense works for any payment account, no
 * bank_accounts row required); 'deposit'/'interest' are usually a
 * bank_deposits row but interest earned on an account with no bank_accounts
 * row posts as a plain journal entry instead (see startReconciliation), so
 * that one case is resolved by checking which table actually has the row. */
async function resolveItemTable(
  trx: Kysely<DB> | Transaction<DB>, type: ReconciliationItemType, transaction_id: string,
): Promise<'bank_deposits' | 'expense_transactions' | 'checks' | 'journal_entries'> {
  if (type === 'check') return 'checks';
  if (type === 'journal_entry') return 'journal_entries';
  if (type === 'expense' || type === 'service_charge') return 'expense_transactions';
  const dep = await trx.selectFrom('bank_deposits').select('id').where('id', '=', transaction_id).executeTakeFirst();
  return dep ? 'bank_deposits' : 'journal_entries';
}

const ENTITY_TYPE_FOR_TABLE: Record<'bank_deposits' | 'expense_transactions' | 'checks' | 'journal_entries', string> = {
  bank_deposits: 'bank_deposit', expense_transactions: 'expense_transaction', checks: 'check', journal_entries: 'journal_entry',
};
const UPDATE_ACTIONS = ['expense_transaction.update', 'check.update', 'bank_deposit.update', 'journal_entry.update'];

export async function finishReconciliation(
  trx: Transaction<DB>, ctx: ServiceCtx,
  id: string,
  input: { accept_difference?: boolean; discrepancy_account_id?: string | null },
) {
  const bizId = ctx.business_id!;
  const recon = await trx.selectFrom('reconciliations').selectAll()
    .where('id', '=', id).where('business_id', '=', bizId).forUpdate().executeTakeFirst();
  if (!recon) throw new NotFoundError('reconciliation', id);
  if (recon.status !== 'in_progress') throw new PreconditionError('This reconciliation is no longer in progress');

  const { items, account, summary } = await getWorksheet(trx as unknown as Kysely<DB>, ctx, id);

  if (!isZero(summary.difference) && !input.accept_difference) {
    throw new PreconditionError(
      `There is a ${summary.difference} difference between the books and the statement`,
      { difference: summary.difference },
    );
  }

  let adjustmentJeId: string | null = null;
  if (!isZero(summary.difference) && input.accept_difference) {
    const discrepancyAccount = input.discrepancy_account_id
      ? await trx.selectFrom('chart_of_accounts').selectAll()
        .where('id', '=', input.discrepancy_account_id).where('business_id', '=', bizId).executeTakeFirst()
      : await getOrCreateOpeningBalanceEquity(trx, ctx, bizId);
    if (!discrepancyAccount) throw new NotFoundError('chart_of_accounts', input.discrepancy_account_id!);

    const diff = parseFloat(summary.difference);
    const absDiff = Math.abs(diff).toFixed(2);
    const adjustment = await ledger.postJournalEntry(trx, ctx, {
      business_id: bizId,
      entry_date: recon.statement_ending_date,
      source_type: 'reconciliation_adjustment',
      source_id: recon.id,
      transaction_type: 'reconciliation_adjustment',
      memo: `Reconciliation adjustment — ${account.name} through ${recon.statement_ending_date}`,
      reference: null,
      lines: diff > 0
        ? [
            { account_id: account.id, debit: absDiff, credit: '0', memo: 'Reconciliation adjustment' },
            { account_id: discrepancyAccount.id, debit: '0', credit: absDiff, memo: 'Reconciliation adjustment' },
          ]
        : [
            { account_id: discrepancyAccount.id, debit: absDiff, credit: '0', memo: 'Reconciliation adjustment' },
            { account_id: account.id, debit: '0', credit: absDiff, memo: 'Reconciliation adjustment' },
          ],
    });
    adjustmentJeId = adjustment.id;
  }

  // Lock every cleared item's source row as reconciled.
  for (const item of items) {
    if (!item.is_cleared) continue;
    const table = await resolveItemTable(trx, item.transaction_type, item.transaction_id);
    await trx.updateTable(table)
      .set({ reconciliation_status: 'reconciled', reconciliation_id: id })
      .where('id', '=', item.transaction_id)
      .execute();
  }

  const clearedItems = items.filter(i => i.is_cleared);
  if (clearedItems.length > 0) {
    await trx.insertInto('reconciliation_items').values(clearedItems.map(i => ({
      reconciliation_id: id,
      transaction_type: i.transaction_type,
      transaction_id: i.transaction_id,
      transaction_date: i.transaction_date,
      description: i.description,
      amount: i.amount,
      is_cleared: true,
      cleared_at: sql`now()`,
    }))).onConflict(oc => oc.columns(['reconciliation_id', 'transaction_type', 'transaction_id']).doUpdateSet({
      is_cleared: true, cleared_at: sql`now()`,
    })).execute();
  }

  const completed = await trx.updateTable('reconciliations')
    .set({
      status: 'completed',
      difference: isZero(summary.difference) ? '0' : summary.difference,
      adjustment_journal_entry_id: adjustmentJeId,
      completed_at: sql`now()`,
      completed_by_user_id: ctx.user_id,
    })
    .where('id', '=', id).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.BANK_RECONCILIATION_FINISH,
    entity_type: 'reconciliation',
    entity_id: id,
    before: recon,
    after: completed,
  });

  return completed;
}

export async function cancelReconciliation(trx: Transaction<DB>, ctx: ServiceCtx, id: string) {
  const bizId = ctx.business_id!;
  const recon = await trx.selectFrom('reconciliations').selectAll()
    .where('id', '=', id).where('business_id', '=', bizId).forUpdate().executeTakeFirst();
  if (!recon) throw new NotFoundError('reconciliation', id);
  if (recon.status !== 'in_progress') throw new PreconditionError('This reconciliation is no longer in progress');

  // Service-charge/interest rows created at Start exist only for this attempt — remove
  // them entirely, JE included. Deleting a journal entry is normally firm-admin-only;
  // this is the system undoing its own Start, not a user-initiated delete, so it runs
  // as if by a firm admin regardless of who is actually cancelling (already accountant+).
  const deleteCtx: ServiceCtx = { ...ctx, effective_role: 'firm_admin' };
  const specialItems = await trx.selectFrom('reconciliation_items').selectAll()
    .where('reconciliation_id', '=', id)
    .where('transaction_type', 'in', ['service_charge', 'interest'])
    .execute();
  for (const item of specialItems) {
    if (item.transaction_type === 'service_charge') {
      await expenseSvc.deleteExpense(trx, deleteCtx, item.transaction_id);
    } else if (item.transaction_type === 'interest') {
      const table = await resolveItemTable(trx, 'interest', item.transaction_id);
      if (table === 'bank_deposits') {
        await depositSvc.deleteDeposit(trx, deleteCtx, item.transaction_id);
      } else {
        await ledger.deleteJournalEntry(trx, deleteCtx, { journal_entry_id: item.transaction_id });
      }
    }
  }

  await trx.deleteFrom('reconciliation_items').where('reconciliation_id', '=', id).execute();
  const cancelled = await trx.updateTable('reconciliations').set({ status: 'cancelled' })
    .where('id', '=', id).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.BANK_RECONCILIATION_CANCEL,
    entity_type: 'reconciliation',
    entity_id: id,
    before: recon,
    after: cancelled,
  });

  return cancelled;
}

export async function listHistory(db: Kysely<DB>, ctx: ServiceCtx, q: { account_id?: string }) {
  const bizId = ctx.business_id!;
  let query = db.selectFrom('reconciliations as r')
    .leftJoin('users as u', 'u.id', 'r.completed_by_user_id')
    .leftJoin('chart_of_accounts as a', 'a.id', 'r.account_id')
    .select([
      'r.id', 'r.account_id', 'a.code as account_code', 'a.name as account_name',
      'a.account_type', 'a.detail_type', 'r.statement_ending_date', 'r.statement_ending_balance',
      'r.difference', 'r.adjustment_journal_entry_id', 'r.status', 'r.completed_at', 'u.full_name as completed_by',
    ])
    .where('r.business_id', '=', bizId)
    .where('r.status', 'in', ['completed', 'cancelled']);
  if (q.account_id) query = query.where('r.account_id', '=', q.account_id);
  const rows = await query.orderBy('r.statement_ending_date', 'desc').execute();
  if (rows.length === 0) return [];

  const bankRows = await db.selectFrom('bank_accounts').select('cash_account_id')
    .where('business_id', '=', bizId).where('deleted_at', 'is', null).execute();
  const bankSet = new Set(bankRows.map(b => b.cash_account_id));

  const items = await db.selectFrom('reconciliation_items').selectAll()
    .where('reconciliation_id', 'in', rows.map(r => r.id))
    .where('is_cleared', '=', true)
    .execute();
  const itemsByRecon = new Map<string, typeof items>();
  for (const item of items) {
    const list = itemsByRecon.get(item.reconciliation_id) ?? [];
    list.push(item);
    itemsByRecon.set(item.reconciliation_id, list);
  }

  // "Changes": how many of a reconciliation's cleared transactions were
  // edited afterward — one audit-log sweep for every item across every row,
  // matched back by (entity_type, entity_id) to whichever reconciliation
  // actually reconciled it (a row can only be cleared by one at a time).
  const changesCount = new Map<string, number>();
  if (items.length > 0) {
    const resolvedByKey = new Map<string, { entity_type: string; reconciliation_id: string; completed_at_ms: number | null }>();
    for (const item of items) {
      const table = await resolveItemTable(db, item.transaction_type, item.transaction_id);
      const completedAt = rows.find(r => r.id === item.reconciliation_id)?.completed_at;
      resolvedByKey.set(`${table}:${item.transaction_id}`, {
        entity_type: ENTITY_TYPE_FOR_TABLE[table],
        reconciliation_id: item.reconciliation_id,
        completed_at_ms: completedAt ? new Date(completedAt as unknown as string).getTime() : null,
      });
    }
    const entityIds = [...new Set(items.map(i => i.transaction_id))];
    const logs = await db.selectFrom('audit_logs')
      .select(['entity_type', 'entity_id', 'created_at'])
      .where('business_id', '=', bizId)
      .where('entity_id', 'in', entityIds)
      .where('action', 'in', UPDATE_ACTIONS)
      .execute();
    for (const log of logs) {
      if (!log.entity_id) continue;
      for (const [key, resolved] of resolvedByKey) {
        if (!key.endsWith(`:${log.entity_id}`) || resolved.entity_type !== log.entity_type) continue;
        if (resolved.completed_at_ms === null || new Date(log.created_at as unknown as string).getTime() <= resolved.completed_at_ms) continue;
        changesCount.set(resolved.reconciliation_id, (changesCount.get(resolved.reconciliation_id) ?? 0) + 1);
      }
    }
  }

  return rows.map(r => ({
    ...r,
    category: reconcilableCategory({ account_type: r.account_type ?? 'asset', detail_type: r.detail_type }, bankSet.has(r.account_id)),
    items_cleared: itemsByRecon.get(r.id)?.length ?? 0,
    changes: changesCount.get(r.id) ?? 0,
    auto_adjustment: r.adjustment_journal_entry_id ? r.difference : null,
  }));
}

/**
 * Everything a fixed, standalone reconciliation report needs in one call: the
 * reconciliation itself, who completed it, its account (with the same
 * category label the worksheet and history already use), and every cleared
 * line, frozen at Finish (see finishReconciliation) and never recomputed —
 * the report reads exactly what was true the day this was completed, even if
 * the account's name or a transaction's memo changes afterward.
 */
export async function getReconciliationDetail(db: Kysely<DB>, ctx: ServiceCtx, id: string) {
  const recon = await db.selectFrom('reconciliations as r')
    .leftJoin('users as u', 'u.id', 'r.completed_by_user_id')
    .leftJoin('chart_of_accounts as a', 'a.id', 'r.account_id')
    .selectAll('r')
    .select(['a.code as account_code', 'a.name as account_name', 'a.account_type', 'a.detail_type', 'u.full_name as completed_by'])
    .where('r.id', '=', id).where('r.business_id', '=', ctx.business_id!).executeTakeFirst();
  if (!recon) throw new NotFoundError('reconciliation', id);
  const bankRow = await bankAccountFor(db, ctx.business_id!, recon.account_id);
  const items = await db.selectFrom('reconciliation_items').selectAll()
    .where('reconciliation_id', '=', id).orderBy('transaction_date').execute();
  return {
    reconciliation: recon,
    category: reconcilableCategory({ account_type: recon.account_type!, detail_type: recon.detail_type }, !!bankRow),
    items,
  };
}

/** Only the latest completed reconciliation on an account may be undone — undoing an older one first requires undoing every newer one. Firm-admin only (checked at the route). */
export async function undoReconciliation(trx: Transaction<DB>, ctx: ServiceCtx, id: string) {
  if (!hasMinRole(ctx.effective_role, 'firm_admin')) {
    throw new PreconditionError('Only a firm admin may undo a reconciliation');
  }
  const bizId = ctx.business_id!;
  const recon = await trx.selectFrom('reconciliations').selectAll()
    .where('id', '=', id).where('business_id', '=', bizId).forUpdate().executeTakeFirst();
  if (!recon) throw new NotFoundError('reconciliation', id);
  if (recon.status !== 'completed') throw new PreconditionError('Only a completed reconciliation can be undone');

  const latest = await trx.selectFrom('reconciliations').select('id')
    .where('account_id', '=', recon.account_id).where('status', '=', 'completed')
    .orderBy('statement_ending_date', 'desc').executeTakeFirst();
  if (latest?.id !== id) {
    throw new PreconditionError('Only the most recent reconciliation on this account can be undone — undo the newer ones first');
  }

  const items = await trx.selectFrom('reconciliation_items').selectAll()
    .where('reconciliation_id', '=', id).where('is_cleared', '=', true).execute();
  for (const item of items) {
    const table = await resolveItemTable(trx, item.transaction_type, item.transaction_id);
    await trx.updateTable(table)
      .set({ reconciliation_status: 'unreconciled', reconciliation_id: null })
      .where('id', '=', item.transaction_id)
      .where('reconciliation_id', '=', id)
      .execute();
  }

  if (recon.adjustment_journal_entry_id) {
    await ledger.voidJournalEntry(trx, ctx, {
      journal_entry_id: recon.adjustment_journal_entry_id,
      void_reason: `Reconciliation of ${recon.statement_ending_date} undone`,
      reversal_date: recon.statement_ending_date,
      source_guard: { source_type: 'reconciliation_adjustment', source_id: recon.id },
    });
  }

  const undone = await trx.updateTable('reconciliations')
    .set({ status: 'in_progress', completed_at: null, completed_by_user_id: null, adjustment_journal_entry_id: null })
    .where('id', '=', id).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.BANK_RECONCILIATION_UNDO,
    entity_type: 'reconciliation',
    entity_id: id,
    before: recon,
    after: undone,
  });

  return undone;
}
