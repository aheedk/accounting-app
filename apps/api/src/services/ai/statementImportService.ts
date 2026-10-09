import { sql, type Kysely, type Transaction } from 'kysely';
import { ERR } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import type { ServiceCtx } from '../../lib/ctx.js';
import { BusinessRuleError } from '../../lib/errors.js';
import { postJournalEntryBatch, type PostJournalEntryInput } from '../core/ledgerService.js';
import { wrapImportedDepositJournalEntry } from '../banking/bankDepositService.js';
import { wrapImportedExpenseJournalEntry } from '../ap/expenseTransactionService.js';
import { describeTransactions } from '../core/transactionDescriptorService.js';
import { markCheckStubMatched } from './checkStubService.js';

// Posting bank and credit card statements from the AI inbox.
// Spec: docs/specs/2026-10-04-card-statements-and-check-stubs-design.md

export type StatementKind = 'bank' | 'credit_card';
/** What a credit card statement line is. */
export type CardLineType = 'charge' | 'payment' | 'refund';

/**
 * One line as it sits in `email_import_staging.extracted_transactions`.
 * `type` is always in the bank-statement shape: an inflow (`deposit`/`credit`)
 * moves money into the statement's account, everything else moves it out.
 */
export type StatementLine = {
  date: string;
  payee_name?: string;
  description: string;
  amount: string;
  type: 'deposit' | 'check' | 'expense' | 'debit' | 'credit';
  balance?: string;
  check_number?: string;
  card_type?: CardLineType;
  suggested_offset?: string;
  suggested_account_id?: string;
  auto_posted?: boolean;
};

export type RawCardLine = {
  date?: string;
  payee_name?: string;
  description?: string;
  amount?: string;
  type?: string;
  suggested_offset?: string;
};

/** Money comes into the statement's account (a deposit, or a payment/refund on a card). */
export function isInflow(line: Pick<StatementLine, 'type'>): boolean {
  return line.type === 'deposit' || line.type === 'credit';
}

/** "MM/DD/YYYY" (as extracted) to ISO "YYYY-MM-DD". */
export function statementDateToIso(date: string): string {
  const [m, d, y] = date.split('/');
  return `${y}-${m?.padStart(2, '0')}-${d?.padStart(2, '0')}`;
}

/**
 * Card lines into the bank-statement shape. A charge takes money "out" of the
 * card account (raises what is owed); a payment or refund puts it back "in".
 * Anything the model left unlabelled is treated as a charge, the common case.
 */
export function normalizeCardLines(raw: RawCardLine[]): StatementLine[] {
  return raw.map(line => {
    const kind: CardLineType = line.type === 'payment' ? 'payment'
      : line.type === 'refund' || line.type === 'credit' ? 'refund'
      : 'charge';
    const normalized: StatementLine = {
      date: line.date ?? '',
      description: line.description ?? '',
      amount: String(Math.abs(Number(line.amount ?? 0))),
      type: kind === 'charge' ? 'expense' : 'deposit',
      card_type: kind,
    };
    if (line.payee_name) normalized.payee_name = line.payee_name;
    if (line.suggested_offset) normalized.suggested_offset = line.suggested_offset;
    return normalized;
  });
}

const CHECK_NUMBER = /\b(?:check|chk|ck)\s*(?:no\.?|number|num|#)?\s*#?\s*(\d{2,10})\b/i;

/** The check number on a statement line: the extracted field, else read from the description. */
export function checkNumberOf(line: Pick<StatementLine, 'check_number' | 'description'>): string | null {
  const explicit = line.check_number?.trim().replace(/^#/, '');
  if (explicit) return explicit;
  const match = CHECK_NUMBER.exec(line.description ?? '');
  return match?.[1] ?? null;
}

/** The `transaction_type` recorded on the posted journal entry (drives the ledger's label). */
function entryTransactionType(kind: StatementKind, line: StatementLine): string {
  if (kind === 'credit_card') {
    if (line.card_type === 'payment') return 'credit_card_payment';
    if (line.card_type === 'refund') return 'credit_card_credit';
    return 'expense';
  }
  if (isInflow(line)) return 'deposit';
  return line.type === 'check' ? 'check' : 'expense';
}

/** A payment toward the card, as it shows on the card's own statement. */
export function isCardStatementPayment(kind: StatementKind, line: Pick<StatementLine, 'card_type'>): boolean {
  return kind === 'credit_card' && line.card_type === 'payment';
}

export type PostStatementItem = {
  index: number;
  offset_account_id: string;
  payee_name?: string | null;
  /** A check stub this line was matched to; marked used once the line posts. */
  check_stub_id?: string | null;
};

/**
 * The account the statement belongs to must exist in this business, and be a
 * liability for a card statement (asset or liability for a bank statement --
 * a line of credit can have a statement too).
 */
async function assertStatementAccount(
  db: Kysely<DB> | Transaction<DB>, businessId: string, kind: StatementKind, accountId: string,
): Promise<void> {
  const account = await db.selectFrom('chart_of_accounts').select(['account_type'])
    .where('id', '=', accountId)
    .where('business_id', '=', businessId)
    .executeTakeFirst();
  if (!account) throw new BusinessRuleError(ERR.NOT_FOUND, 'Statement account not found');
  if (kind === 'credit_card' && account.account_type !== 'liability') {
    throw new BusinessRuleError(
      ERR.VALIDATION_FAILED,
      'A credit card statement must post to a credit card (liability) account.',
    );
  }
  if (kind === 'bank' && account.account_type !== 'asset' && account.account_type !== 'liability') {
    throw new BusinessRuleError(ERR.VALIDATION_FAILED, 'A bank statement must post to a bank or cash account.');
  }
}

/**
 * Post the chosen lines of a staged statement, one journal entry each, and give
 * each the record a person would open to edit it: charges and payments out of a
 * bank become Expenses, bank deposits become Bank Deposits. Card payments and
 * refunds stay imported entries (edited on /transactions/:id).
 *
 * A payment on a card statement is never posted from here: the bank statement
 * it was paid from records it (debit the card, credit the bank), and posting it
 * from both would count it twice.
 *
 * Returns the created entry ids in the same order as `items`; a line that was
 * already auto-posted, or is a card statement's payment, gets null.
 */
export async function postStatementLines(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: {
    staging_id: string;
    statement_kind: StatementKind;
    lines: StatementLine[];
    account_id: string;
    items: PostStatementItem[];
  },
): Promise<Array<string | null>> {
  const businessId = ctx.business_id;
  if (!businessId) throw new BusinessRuleError(ERR.NOT_FOUND, 'No business selected');
  await assertStatementAccount(trx, businessId, input.statement_kind, input.account_id);

  const postable = input.items.flatMap(item => {
    const line = input.lines[item.index];
    return line && !line.auto_posted && !isCardStatementPayment(input.statement_kind, line) ? [{ item, line }] : [];
  });
  if (postable.some(({ item }) => item.offset_account_id === input.account_id)) {
    throw new BusinessRuleError(
      ERR.VALIDATION_FAILED,
      'A line cannot be coded to the statement’s own account.',
    );
  }

  const entries: PostJournalEntryInput[] = postable.map(({ item, line }) => {
    const amount = Number(line.amount).toFixed(2);
    const inflow = isInflow(line);
    const payee = item.payee_name?.trim() || line.payee_name || null;
    return {
      business_id: businessId,
      entry_date: statementDateToIso(line.date),
      source_type: 'bank_import',
      transaction_type: entryTransactionType(input.statement_kind, line),
      source_id: input.staging_id,
      memo: line.description,
      // A bank deposit has no payee column; everything else carries one.
      payee_name: input.statement_kind === 'bank' && inflow ? null : payee,
      reference: input.statement_kind === 'bank' && line.type === 'check' ? checkNumberOf(line) : null,
      lines: [
        { account_id: input.account_id, debit: inflow ? amount : '0.00', credit: inflow ? '0.00' : amount, memo: line.description },
        { account_id: item.offset_account_id, debit: inflow ? '0.00' : amount, credit: inflow ? amount : '0.00', memo: line.description },
      ],
    };
  });

  const created = await postJournalEntryBatch(trx, ctx, entries);

  for (let i = 0; i < postable.length; i += 1) {
    const { item, line } = postable[i]!;
    const entry = created[i];
    const posted = entries[i]!;
    if (!entry) continue;
    const amount = Number(line.amount).toFixed(2);
    const payee = item.payee_name?.trim() || line.payee_name || null;

    if (input.statement_kind === 'bank' && isInflow(line)) {
      await wrapImportedDepositJournalEntry(trx, ctx, {
        journal_entry_id: entry.id,
        chart_account_id: input.account_id,
        offset_account_id: item.offset_account_id,
        entry_date: posted.entry_date,
        description: line.description,
        amount,
      });
    } else if (!isInflow(line)) {
      await wrapImportedExpenseJournalEntry(trx, ctx, {
        journal_entry_id: entry.id,
        payment_account_id: input.account_id,
        category_account_id: item.offset_account_id,
        payment_method: input.statement_kind === 'credit_card' ? 'credit_card'
          : line.type === 'check' ? 'check' : 'other',
        entry_date: posted.entry_date,
        description: line.description,
        payee_name: payee,
        // Same value the JE itself got above (posted.reference) — keeps the
        // wrapper row's own Ref No. in sync with it.
        reference: posted.reference ?? null,
        amount,
      });
    }

    if (item.check_stub_id) {
      await markCheckStubMatched(trx, ctx, { stub_id: item.check_stub_id, journal_entry_id: entry.id, amount });
    }
  }

  const byIndex = new Map(postable.map(({ item }, i) => [item.index, created[i]?.id ?? null]));
  return input.items.map(item => byIndex.get(item.index) ?? null);
}

export type AlreadyRecorded = {
  index: number;
  journal_entry_id: string;
  entry_date: string;
  label: string;
  path: string;
};

const MATCH_WINDOW_DAYS = 5;

/**
 * Lines whose money movement is already in the books from another document --
 * a card payment that shows on both the bank and the card statement, or a
 * transfer that shows on both bank statements. Only lines coded to another
 * balance-sheet account can be double-counted this way; category lines (an
 * expense, an income account) are never checked.
 *
 * An offset of null asks "from any bank or other asset account": a card
 * statement's payment line, which does not say which account paid it.
 */
export async function findAlreadyRecorded(
  db: Kysely<DB>,
  ctx: ServiceCtx,
  input: {
    staging_id: string;
    account_id: string;
    lines: StatementLine[];
    offsets: Array<{ index: number; offset_account_id: string | null }>;
  },
): Promise<AlreadyRecorded[]> {
  const businessId = ctx.business_id;
  if (!businessId || input.offsets.length === 0) return [];

  const offsetIds = [...new Set(input.offsets.flatMap(o => (o.offset_account_id ? [o.offset_account_id] : [])))];
  const balanceSheet = new Set(offsetIds.length === 0 ? [] : (await db.selectFrom('chart_of_accounts').select('id')
    .where('business_id', '=', businessId)
    .where('id', 'in', offsetIds)
    .where('account_type', 'in', ['asset', 'liability'])
    .execute()).map(row => row.id));

  const used = new Set<string>();
  const found: Array<Omit<AlreadyRecorded, 'label' | 'path'>> = [];
  for (const { index, offset_account_id } of input.offsets) {
    const line = input.lines[index];
    if (!line || line.auto_posted || (offset_account_id !== null && !balanceSheet.has(offset_account_id))) continue;
    const amount = Number(line.amount).toFixed(4);
    const inflow = isInflow(line);
    const date = statementDateToIso(line.date);

    const candidates = await db.selectFrom('journal_entries as je')
      .innerJoin('journal_entry_lines as own', 'own.journal_entry_id', 'je.id')
      .innerJoin('journal_entry_lines as other', 'other.journal_entry_id', 'je.id')
      .select(['je.id', 'je.entry_date'])
      .where('je.business_id', '=', businessId)
      .where('je.status', '=', 'posted')
      .where(sql<boolean>`je.entry_date BETWEEN ${date}::date - ${MATCH_WINDOW_DAYS}::int AND ${date}::date + ${MATCH_WINDOW_DAYS}::int`)
      // Not something this same statement posted.
      .where(eb => eb.not(eb.and([eb('je.source_type', '=', 'bank_import'), eb('je.source_id', '=', input.staging_id)])))
      .where('own.account_id', '=', input.account_id)
      .where(inflow ? 'own.debit' : 'own.credit', '=', amount)
      .where(eb => (offset_account_id !== null
        ? eb('other.account_id', '=', offset_account_id)
        : eb.exists(eb.selectFrom('chart_of_accounts as paid_from').select('paid_from.id')
          .whereRef('paid_from.id', '=', 'other.account_id')
          .where('paid_from.account_type', '=', 'asset'))))
      .where(inflow ? 'other.credit' : 'other.debit', '=', amount)
      .orderBy(sql`abs(je.entry_date - ${date}::date)`)
      .execute();
    const match = candidates.find(candidate => !used.has(candidate.id));
    if (!match) continue;
    used.add(match.id);
    found.push({ index, journal_entry_id: match.id, entry_date: String(match.entry_date) });
  }
  if (found.length === 0) return [];

  const entries = await db.selectFrom('journal_entries')
    .select(['id', 'source_type', 'source_id', 'transaction_type', 'payee_name', 'reference', 'journal_number'])
    .where('id', 'in', found.map(f => f.journal_entry_id))
    .execute();
  const descriptors = await describeTransactions(db, entries.map(entry => ({
    ...entry, transaction_type: entry.transaction_type ?? null, payee_name: entry.payee_name ?? null,
  })));
  return found.map(f => {
    const described = descriptors.get(f.journal_entry_id);
    return {
      ...f,
      label: described?.label ?? 'Journal Entry',
      path: described?.path ?? `/journal/${f.journal_entry_id}`,
    };
  });
}

/**
 * The card account a statement most likely belongs to, from the issuer name and
 * last four digits read off it. Null when nothing points at one card.
 */
export async function guessCardAccount(
  db: Kysely<DB>, businessId: string, hint: string | null,
): Promise<string | null> {
  const cards = await db.selectFrom('chart_of_accounts as a')
    .leftJoin('bank_accounts as b', join => join
      .onRef('b.cash_account_id', '=', 'a.id')
      .on('b.deleted_at', 'is', null))
    .select(['a.id', 'a.name', 'a.detail_type', 'b.name as bank_name', 'b.institution', 'b.account_last_four'])
    .where('a.business_id', '=', businessId)
    .where('a.account_type', '=', 'liability')
    .where('a.is_active', '=', true)
    .execute();
  const creditCards = cards.filter(card => card.detail_type === 'Credit Card'
    || /credit\s?card|visa|mastercard|amex|american express|discover/i.test(card.name));
  const text = (hint ?? '').toLowerCase();
  const last4 = /(\d{4})\D*$/.exec(text)?.[1];
  if (last4) {
    const byLast4 = cards.filter(card => card.account_last_four === last4 || card.name.includes(last4));
    if (byLast4.length === 1) return byLast4[0]!.id;
  }
  if (text) {
    const byName = creditCards.filter(card => [card.name, card.bank_name, card.institution]
      .some(part => {
        const words = (part ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !/^(card|credit|account|business)$/.test(w));
        return words.some(word => text.includes(word));
      }));
    if (byName.length === 1) return byName[0]!.id;
  }
  return creditCards.length === 1 ? creditCards[0]!.id : null;
}

export type StatementPart<L> = { account_hint: string | null; lines: L[] };

/**
 * One file can hold several accounts (a bank's checking and savings for the
 * month). Each becomes its own statement, since each posts to its own account.
 */
export function splitByAccount<L extends { account_last4?: string | undefined }>(
  lines: L[],
  accounts: Array<{ name?: string | undefined; last4?: string | undefined }> | undefined,
): Array<StatementPart<L>> {
  const known = (accounts ?? []).filter(a => a.name || a.last4);
  const hintFor = (last4: string | undefined): string | null => {
    const account = known.find(a => last4 && a.last4 === last4) ?? (known.length === 1 ? known[0] : undefined);
    const parts = [account?.name, account?.last4 ?? last4].filter(Boolean);
    return parts.length > 0 ? parts.join(' ') : null;
  };
  const groups = new Map<string, L[]>();
  for (const line of lines) {
    const key = line.account_last4?.trim() ?? '';
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }
  if (groups.size <= 1) return [{ account_hint: hintFor(lines[0]?.account_last4), lines }];
  return [...groups.entries()].map(([last4, group]) => ({ account_hint: hintFor(last4 || undefined), lines: group }));
}
