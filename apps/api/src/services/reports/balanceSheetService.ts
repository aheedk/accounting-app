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
  /** Net income from the start of the fiscal year (`fiscal_year_start`) to `as_of`. */
  net_income_ytd: string;
  fiscal_year_start: string;
  /** Profit of earlier years, already included in the Retained Earnings line and in `equity_total`. */
  retained_earnings_prior_years: string;
  liabilities_equity_total: string;
  in_balance: boolean;
};

/** First day of the fiscal year that `asOf` falls in. */
export function fiscalYearStart(asOf: string, startMonth: number): string {
  const year = Number(asOf.slice(0, 4));
  const month = Number(asOf.slice(5, 7));
  const startYear = month >= startMonth ? year : year - 1;
  return `${startYear}-${String(startMonth).padStart(2, '0')}-01`;
}

/** Revenue less expenses over a date range; `from` null means from the beginning. */
async function netIncomeBetween(
  db: Kysely<DB>, business_id: string, from: string | null, to: string,
): Promise<string> {
  let query = db.selectFrom('journal_entry_lines as jel')
    .innerJoin('journal_entries as je', 'je.id', 'jel.journal_entry_id')
    .innerJoin('chart_of_accounts as a', 'a.id', 'jel.account_id')
    .select(({ fn }) => [
      fn.coalesce(fn.sum<string>('jel.debit'), sql.lit('0')).as('total_debit'),
      fn.coalesce(fn.sum<string>('jel.credit'), sql.lit('0')).as('total_credit'),
    ])
    .where('a.business_id', '=', business_id)
    .where('a.account_type', 'in', ['revenue', 'expense'])
    .where('je.status', 'in', ['posted', 'voided'])
    .where('je.entry_date', '<=', to);
  if (from !== null) query = query.where('je.entry_date', '>=', from);
  const row = await query.executeTakeFirst();
  return toMoneyString(subMoney(row?.total_credit ?? '0', row?.total_debit ?? '0'));
}

export async function balanceSheet(db: Kysely<DB>, q: { business_id: string; as_of: string }): Promise<BalanceSheetReport> {
  const business = await db.selectFrom('businesses').select('fiscal_year_start_month')
    .where('id', '=', q.business_id).executeTakeFirst();
  const ytdStart = fiscalYearStart(q.as_of, business?.fiscal_year_start_month ?? 1);

  // Aggregate JE lines per account up to as_of date
  const rows = await db.selectFrom('chart_of_accounts as a')
    .leftJoin('journal_entry_lines as jel', 'jel.account_id', 'a.id')
    .leftJoin('journal_entries as je', 'je.id', 'jel.journal_entry_id')
    .select(({ fn }) => [
      'a.id as account_id', 'a.code', 'a.name', 'a.account_type', 'a.system_key',
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
    .groupBy(['a.id', 'a.code', 'a.name', 'a.account_type', 'a.system_key'])
    .orderBy('a.code')
    .execute();

  // Profit of earlier fiscal years belongs to Retained Earnings. Nothing posts it
  // there at year end, so it is added here, the way QuickBooks does; without it
  // the sheet goes out of balance the day a new fiscal year starts.
  const dayBeforeYtd = new Date(new Date(`${ytdStart}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
  const priorEarnings = await netIncomeBetween(db, q.business_id, null, dayBeforeYtd);
  const retainedAccount = rows.find(r => r.system_key === 'retained_earnings')
    ?? rows.find(r => r.account_type === 'equity' && /retained earnings/i.test(r.name));

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
      const posted = toMoneyString(subMoney(credit, debit));
      const amt = r.account_id === retainedAccount?.account_id ? toMoneyString(addMoney(posted, priorEarnings)) : posted;
      if (parseFloat(amt) === 0) continue;
      equityLines.push({ account_id: r.account_id, account_code: r.code, account_name: r.name, amount: amt });
      equityTotal = toMoneyString(addMoney(equityTotal, amt));
    }
  }

  // A chart with no Retained Earnings account still has to carry the earlier years.
  if (!retainedAccount && parseFloat(priorEarnings) !== 0) {
    equityLines.push({ account_id: '', account_code: '', account_name: 'Retained Earnings', amount: priorEarnings });
    equityTotal = toMoneyString(addMoney(equityTotal, priorEarnings));
  }

  const netIncomeYtd = await netIncomeBetween(db, q.business_id, ytdStart, q.as_of);

  const liabEquity = toMoneyString(addMoney(addMoney(liabilitiesTotal, equityTotal), netIncomeYtd));
  const inBalance = Math.abs(parseFloat(assetsTotal) - parseFloat(liabEquity)) < 0.01;

  return {
    as_of: q.as_of,
    asset_lines: assetLines, assets_total: assetsTotal,
    liability_lines: liabilityLines, liabilities_total: liabilitiesTotal,
    equity_lines: equityLines, equity_total: equityTotal,
    net_income_ytd: netIncomeYtd,
    fiscal_year_start: ytdStart,
    retained_earnings_prior_years: priorEarnings,
    liabilities_equity_total: liabEquity,
    in_balance: inBalance,
  };
}
