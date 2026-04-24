import { type Kysely, sql } from 'kysely';
import { addMoney, subMoney, toMoneyString } from '@accounting/shared';
import type { DB } from '../../db/types.js';

export type CashFlowLine = {
  entry_date: string;
  journal_entry_id: string;
  source_type: string;
  memo: string | null;
  debit: string;
  credit: string;
  net_amount: string; // debit - credit (positive = inflow)
  running_balance: string;
};

export type CashFlowReport = {
  period_start: string;
  period_end: string;
  cash_account_id: string;
  cash_account_code: string;
  cash_account_name: string;
  beginning_balance: string;
  ending_balance: string;
  net_change: string;
  lines: CashFlowLine[];
};

async function cashAccountBalance(db: Kysely<DB>, cash_account_id: string, as_of: string): Promise<string> {
  const row = await db.selectFrom('journal_entry_lines as jel')
    .innerJoin('journal_entries as je', 'je.id', 'jel.journal_entry_id')
    .select(({ fn }) => [
      fn.coalesce(fn.sum<string>('jel.debit'), sql.lit('0')).as('total_debit'),
      fn.coalesce(fn.sum<string>('jel.credit'), sql.lit('0')).as('total_credit'),
    ])
    .where('jel.account_id', '=', cash_account_id)
    .where('je.status', '=', 'posted')
    .where('je.entry_date', '<=', as_of)
    .executeTakeFirst();
  return toMoneyString(subMoney(row?.total_debit ?? '0', row?.total_credit ?? '0'));
}

export async function cashFlow(db: Kysely<DB>, q: { business_id: string; period_start: string; period_end: string; cash_account_id?: string }): Promise<CashFlowReport> {
  let cashAccountId = q.cash_account_id;
  let cashCode = '';
  let cashName = '';
  if (!cashAccountId) {
    // Default: use system code 1020 (Operating Bank Account)
    const row = await db.selectFrom('chart_of_accounts').selectAll()
      .where('business_id', '=', q.business_id).where('code', '=', '1020').executeTakeFirstOrThrow();
    cashAccountId = row.id;
    cashCode = row.code;
    cashName = row.name;
  } else {
    const row = await db.selectFrom('chart_of_accounts').selectAll()
      .where('id', '=', cashAccountId).where('business_id', '=', q.business_id).executeTakeFirstOrThrow();
    cashCode = row.code;
    cashName = row.name;
  }

  // Beginning balance = balance one day before period_start
  const dayBefore = new Date(new Date(q.period_start + 'T00:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);
  const beginning = await cashAccountBalance(db, cashAccountId, dayBefore);

  const activity = await db.selectFrom('journal_entry_lines as jel')
    .innerJoin('journal_entries as je', 'je.id', 'jel.journal_entry_id')
    .select(['je.entry_date', 'je.id as journal_entry_id', 'je.source_type', 'je.memo', 'jel.debit', 'jel.credit'])
    .where('jel.account_id', '=', cashAccountId)
    .where('je.status', '=', 'posted')
    .where('je.entry_date', '>=', q.period_start)
    .where('je.entry_date', '<=', q.period_end)
    .orderBy('je.entry_date')
    .orderBy('je.created_at')
    .execute();

  let running = beginning;
  const lines: CashFlowLine[] = activity.map(r => {
    const net = toMoneyString(subMoney(r.debit, r.credit));
    running = toMoneyString(addMoney(running, net));
    return {
      entry_date: r.entry_date, journal_entry_id: r.journal_entry_id,
      source_type: r.source_type, memo: r.memo,
      debit: toMoneyString(addMoney(r.debit, '0')), credit: toMoneyString(addMoney(r.credit, '0')),
      net_amount: net, running_balance: running,
    };
  });

  const ending = await cashAccountBalance(db, cashAccountId, q.period_end);
  const netChange = toMoneyString(subMoney(ending, beginning));

  return {
    period_start: q.period_start, period_end: q.period_end,
    cash_account_id: cashAccountId, cash_account_code: cashCode, cash_account_name: cashName,
    beginning_balance: beginning, ending_balance: ending, net_change: netChange,
    lines,
  };
}
