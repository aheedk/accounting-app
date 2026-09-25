import { type Kysely, sql } from 'kysely';
import { ERR, addMoney, isZero, subMoney, toMoneyString } from '@accounting/shared';
import type { AccountType, DB, JournalEntrySourceType, JournalEntryStatus } from '../../db/types.js';
import { BusinessRuleError } from '../../lib/errors.js';

export type GeneralLedgerLine = {
  journal_entry_id: string;
  line_id: string;
  entry_date: string;
  source_type: JournalEntrySourceType;
  reference: string | null;
  memo: string | null;
  split_account: string | null;
  status: JournalEntryStatus;
  debit: string;
  credit: string;
  running_balance: string;
};

export type GeneralLedgerAccount = {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: AccountType;
  normal_balance: 'debit' | 'credit';
  beginning_balance: string;
  total_debit: string;
  total_credit: string;
  ending_balance: string;
  lines: GeneralLedgerLine[];
};

export type GeneralLedgerReport = {
  period_start: string;
  period_end: string;
  account_id: string | null;
  accounts: GeneralLedgerAccount[];
  totals: {
    total_debit: string;
    total_credit: string;
  };
};

function isDebitNormal(accountType: AccountType): boolean {
  return accountType === 'asset' || accountType === 'expense';
}

function naturalChange(accountType: AccountType, debit: string, credit: string): string {
  return toMoneyString(isDebitNormal(accountType) ? subMoney(debit, credit) : subMoney(credit, debit));
}

export async function generalLedger(
  db: Kysely<DB>,
  q: { business_id: string; period_start: string; period_end: string; account_id?: string },
): Promise<GeneralLedgerReport> {
  let accountQuery = db.selectFrom('chart_of_accounts')
    .select(['id', 'code', 'name', 'account_type'])
    .where('business_id', '=', q.business_id);
  if (q.account_id !== undefined) accountQuery = accountQuery.where('id', '=', q.account_id);

  const accountRows = await accountQuery.orderBy('code').execute();
  if (q.account_id !== undefined && accountRows.length === 0) {
    throw new BusinessRuleError(ERR.NOT_FOUND, `Account ${q.account_id} not found`);
  }

  if (accountRows.length === 0) {
    return {
      period_start: q.period_start,
      period_end: q.period_end,
      account_id: q.account_id ?? null,
      accounts: [],
      totals: { total_debit: '0.0000', total_credit: '0.0000' },
    };
  }

  const accountIds = accountRows.map(account => account.id);
  const openingRows = await db.selectFrom('journal_entry_lines as jel')
    .innerJoin('journal_entries as je', 'je.id', 'jel.journal_entry_id')
    .select(({ fn }) => [
      'jel.account_id',
      fn.coalesce(fn.sum<string>('jel.debit'), sql.lit('0')).as('total_debit'),
      fn.coalesce(fn.sum<string>('jel.credit'), sql.lit('0')).as('total_credit'),
    ])
    .where('je.business_id', '=', q.business_id)
    .where('jel.account_id', 'in', accountIds)
    .where('je.status', 'in', ['posted', 'voided'])
    .where('je.entry_date', '<', q.period_start)
    .groupBy('jel.account_id')
    .execute();

  const openingByAccount = new Map(
    openingRows.map(row => [row.account_id, { debit: row.total_debit, credit: row.total_credit }]),
  );

  const activity = await db.selectFrom('journal_entry_lines as jel')
    .innerJoin('journal_entries as je', 'je.id', 'jel.journal_entry_id')
    .select([
      'jel.id as line_id', 'jel.account_id', 'jel.debit', 'jel.credit', 'jel.memo as line_memo',
      'je.id as journal_entry_id', 'je.entry_date', 'je.source_type', 'je.reference',
      'je.memo as entry_memo', 'je.status',
    ])
    .where('je.business_id', '=', q.business_id)
    .where('jel.account_id', 'in', accountIds)
    .where('je.status', 'in', ['posted', 'voided'])
    .where('je.entry_date', '>=', q.period_start)
    .where('je.entry_date', '<=', q.period_end)
    .orderBy('jel.account_id')
    .orderBy('je.entry_date')
    .orderBy('je.created_at')
    .orderBy('je.id')
    .orderBy('jel.line_number')
    .execute();

  const activityByAccount = new Map<string, typeof activity>();
  for (const line of activity) {
    const lines = activityByAccount.get(line.account_id) ?? [];
    lines.push(line);
    activityByAccount.set(line.account_id, lines);
  }

  // Build the SPLIT column: for each line, find the counter account(s) in the same JE.
  // Two-sided entry → show the counter account name. Multi-way split → show "–Split–".
  const splitMap = new Map<string, string | null>(); // line_id → counter account name
  const jeIds = [...new Set(activity.map(l => l.journal_entry_id))];
  if (jeIds.length > 0) {
    const allJeLines = await db.selectFrom('journal_entry_lines as jel')
      .innerJoin('chart_of_accounts as ca', 'ca.id', 'jel.account_id')
      .select(['jel.journal_entry_id', 'jel.id as line_id', 'ca.name as account_name'])
      .where('jel.journal_entry_id', 'in', jeIds)
      .execute();
    const byJe = new Map<string, Array<{ line_id: string; account_name: string }>>();
    for (const l of allJeLines) {
      const arr = byJe.get(l.journal_entry_id) ?? [];
      arr.push({ line_id: l.line_id, account_name: l.account_name });
      byJe.set(l.journal_entry_id, arr);
    }
    for (const line of activity) {
      const jeLines = byJe.get(line.journal_entry_id) ?? [];
      const others = [...new Set(jeLines.filter(l => l.line_id !== line.line_id).map(l => l.account_name))];
      splitMap.set(line.line_id, others.length === 0 ? null : others.length === 1 ? others[0]! : '–Split–');
    }
  }

  let reportDebit = '0.0000';
  let reportCredit = '0.0000';
  const accounts: GeneralLedgerAccount[] = [];

  for (const account of accountRows) {
    const openingTotals = openingByAccount.get(account.id) ?? { debit: '0', credit: '0' };
    const beginning = naturalChange(account.account_type, openingTotals.debit, openingTotals.credit);
    const rawLines = activityByAccount.get(account.id) ?? [];

    if (q.account_id === undefined && rawLines.length === 0 && isZero(beginning)) continue;

    let running = beginning;
    let totalDebit = '0.0000';
    let totalCredit = '0.0000';
    const lines: GeneralLedgerLine[] = rawLines.map(line => {
      const debit = toMoneyString(line.debit);
      const credit = toMoneyString(line.credit);
      totalDebit = toMoneyString(addMoney(totalDebit, debit));
      totalCredit = toMoneyString(addMoney(totalCredit, credit));
      running = toMoneyString(addMoney(running, naturalChange(account.account_type, debit, credit)));
      return {
        journal_entry_id: line.journal_entry_id,
        line_id: line.line_id,
        entry_date: line.entry_date,
        source_type: line.source_type,
        reference: line.reference,
        memo: line.line_memo ?? line.entry_memo,
        split_account: splitMap.get(line.line_id) ?? null,
        status: line.status,
        debit,
        credit,
        running_balance: running,
      };
    });

    reportDebit = toMoneyString(addMoney(reportDebit, totalDebit));
    reportCredit = toMoneyString(addMoney(reportCredit, totalCredit));
    accounts.push({
      account_id: account.id,
      account_code: account.code,
      account_name: account.name,
      account_type: account.account_type,
      normal_balance: isDebitNormal(account.account_type) ? 'debit' : 'credit',
      beginning_balance: beginning,
      total_debit: totalDebit,
      total_credit: totalCredit,
      ending_balance: running,
      lines,
    });
  }

  return {
    period_start: q.period_start,
    period_end: q.period_end,
    account_id: q.account_id ?? null,
    accounts,
    totals: { total_debit: reportDebit, total_credit: reportCredit },
  };
}
