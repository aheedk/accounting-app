import { type Kysely, sql } from 'kysely';
import { addMoney, subMoney, toMoneyString } from '@accounting/shared';
import type { DB } from '../../db/types.js';

export type BsLine = {
  account_id: string;
  account_code: string;
  account_name: string;
  amount: string;
};

export type BalanceSheetReport = {
  as_of: string;
  asset_lines: BsLine[];
  assets_total: string;
  liability_lines: BsLine[];
  liabilities_total: string;
  equity_lines: BsLine[];
  equity_total: string;
  net_income_ytd: string;
  liabilities_equity_total: string;
  in_balance: boolean;
};

export async function balanceSheet(db: Kysely<DB>, q: { business_id: string; as_of: string }): Promise<BalanceSheetReport> {
  const asOfYear = q.as_of.slice(0, 4);
  const ytdStart = `${asOfYear}-01-01`;

  // Aggregate JE lines per account up to as_of date
  const rows = await db.selectFrom('chart_of_accounts as a')
    .leftJoin('journal_entry_lines as jel', 'jel.account_id', 'a.id')
    .leftJoin('journal_entries as je', 'je.id', 'jel.journal_entry_id')
    .select(({ fn }) => [
      'a.id as account_id', 'a.code', 'a.name', 'a.account_type',
      fn.coalesce(fn.sum<string>('jel.debit'), sql.lit('0')).as('total_debit'),
      fn.coalesce(fn.sum<string>('jel.credit'), sql.lit('0')).as('total_credit'),
    ])
    .where('a.business_id', '=', q.business_id)
    .where(eb => eb.or([
      eb('je.id', 'is', null),
      eb.and([
        // Voids are reversal-based: count the voided original and its posted
        // reversal so the account balance cancels instead of flipping sign.
        eb('je.status', 'in', ['posted', 'voided']),
        eb('je.entry_date', '<=', q.as_of),
      ]),
    ]))
    .groupBy(['a.id', 'a.code', 'a.name', 'a.account_type'])
    .orderBy('a.code')
    .execute();

  const assetLines: BsLine[] = [];
  const liabilityLines: BsLine[] = [];
  const equityLines: BsLine[] = [];
  let assetsTotal = '0.0000';
  let liabilitiesTotal = '0.0000';
  let equityTotal = '0.0000';

  for (const r of rows) {
    const debit = r.total_debit ?? '0';
    const credit = r.total_credit ?? '0';
    if (r.account_type === 'asset') {
      const amt = toMoneyString(subMoney(debit, credit));
      if (parseFloat(amt) === 0) continue;
      assetLines.push({ account_id: r.account_id, account_code: r.code, account_name: r.name, amount: amt });
      assetsTotal = toMoneyString(addMoney(assetsTotal, amt));
    } else if (r.account_type === 'liability') {
      const amt = toMoneyString(subMoney(credit, debit));
      if (parseFloat(amt) === 0) continue;
      liabilityLines.push({ account_id: r.account_id, account_code: r.code, account_name: r.name, amount: amt });
      liabilitiesTotal = toMoneyString(addMoney(liabilitiesTotal, amt));
    } else if (r.account_type === 'equity') {
      const amt = toMoneyString(subMoney(credit, debit));
      if (parseFloat(amt) === 0) continue;
      equityLines.push({ account_id: r.account_id, account_code: r.code, account_name: r.name, amount: amt });
      equityTotal = toMoneyString(addMoney(equityTotal, amt));
    }
  }

  // Net income YTD = sum of revenue - expense from ytdStart to as_of
  const niRows = await db.selectFrom('chart_of_accounts as a')
    .leftJoin('journal_entry_lines as jel', 'jel.account_id', 'a.id')
    .leftJoin('journal_entries as je', 'je.id', 'jel.journal_entry_id')
    .select(({ fn }) => [
      'a.account_type',
      fn.coalesce(fn.sum<string>('jel.debit'), sql.lit('0')).as('total_debit'),
      fn.coalesce(fn.sum<string>('jel.credit'), sql.lit('0')).as('total_credit'),
    ])
    .where('a.business_id', '=', q.business_id)
    .where('a.account_type', 'in', ['revenue', 'expense'])
    .where(eb => eb.or([
      eb('je.id', 'is', null),
      eb.and([
        eb('je.status', 'in', ['posted', 'voided']),
        eb('je.entry_date', '>=', ytdStart),
        eb('je.entry_date', '<=', q.as_of),
      ]),
    ]))
    .groupBy('a.account_type')
    .execute();

  let revenue = '0.0000';
  let expense = '0.0000';
  for (const r of niRows) {
    if (r.account_type === 'revenue') revenue = toMoneyString(subMoney(r.total_credit ?? '0', r.total_debit ?? '0'));
    if (r.account_type === 'expense') expense = toMoneyString(subMoney(r.total_debit ?? '0', r.total_credit ?? '0'));
  }
  const netIncomeYtd = toMoneyString(subMoney(revenue, expense));

  const liabEquity = toMoneyString(addMoney(addMoney(liabilitiesTotal, equityTotal), netIncomeYtd));
  const inBalance = Math.abs(parseFloat(assetsTotal) - parseFloat(liabEquity)) < 0.01;

  return {
    as_of: q.as_of,
    asset_lines: assetLines, assets_total: assetsTotal,
    liability_lines: liabilityLines, liabilities_total: liabilitiesTotal,
    equity_lines: equityLines, equity_total: equityTotal,
    net_income_ytd: netIncomeYtd,
    liabilities_equity_total: liabEquity,
    in_balance: inBalance,
  };
}
