import type { Kysely } from 'kysely';
import type { DB } from '../db/types.js';

// Year end, the way QuickBooks does it: nothing is posted. Income and expense
// accounts start each fiscal year at zero, and the profit of the years before
// is carried in Retained Earnings. Every report that shows a balance works it
// out from these helpers so they all agree.

/** First day of the fiscal year that `date` falls in. */
export function fiscalYearStart(date: string, startMonth: number): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const startYear = month >= startMonth ? year : year - 1;
  return `${startYear}-${String(startMonth).padStart(2, '0')}-01`;
}

export function dayBefore(date: string): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
}

/** First day of the business's fiscal year that `date` falls in. */
export async function businessFiscalYearStart(db: Kysely<DB>, business_id: string, date: string): Promise<string> {
  const business = await db.selectFrom('businesses').select('fiscal_year_start_month')
    .where('id', '=', business_id).executeTakeFirst();
  return fiscalYearStart(date, business?.fiscal_year_start_month ?? 1);
}

/**
 * The account that carries earlier years' profit: the one the chart marks as
 * Retained Earnings, or failing that an equity account with that name.
 */
export function pickRetainedEarnings<T extends { account_type: string; name: string; system_key?: string | null }>(
  accounts: readonly T[],
): T | undefined {
  return accounts.find(a => a.system_key === 'retained_earnings')
    ?? accounts.find(a => a.account_type === 'equity' && /retained earnings/i.test(a.name));
}
