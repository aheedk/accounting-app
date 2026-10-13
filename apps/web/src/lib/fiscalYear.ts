import { useMemo } from 'react';
import { useAuth } from '@/auth/useAuth';
import { useActiveBusinessId } from './business';
import { todayLocal } from './dates';

// "This year" means the client's own fiscal year everywhere: for a company
// whose year runs July to June it is July 1 to June 30, not January to
// December. The first month comes from the company (Setup → Entity).

function validMonth(startMonth: number | null | undefined): number {
  return typeof startMonth === 'number' && startMonth >= 1 && startMonth <= 12 ? Math.floor(startMonth) : 1;
}

/**
 * The fiscal year that `date` (YYYY-MM-DD) falls in, first day to last.
 * `shift` moves it by whole years: -1 is the year before.
 */
export function fiscalYearRange(date: string, startMonth: number, shift = 0): { start: string; end: string } {
  const month = validMonth(startMonth);
  const year = Number(date.slice(0, 4));
  const startYear = (Number(date.slice(5, 7)) >= month ? year : year - 1) + shift;
  // Day 0 of the start month, a year on, is the last day of the month before it.
  const end = new Date(Date.UTC(startYear + 1, month - 1, 0)).toISOString().slice(0, 10);
  return { start: `${startYear}-${String(month).padStart(2, '0')}-01`, end };
}

/** The first month (1 to 12) of the open company's fiscal year; January until it is known. */
export function useFiscalYearStartMonth(): number {
  const [bizId] = useActiveBusinessId();
  const { businesses } = useAuth();
  return validMonth(businesses.find(b => b.id === bizId)?.fiscal_year_start_month);
}

/** The open company's fiscal year as of today, and the one before it. */
export function useFiscalYear(): { startMonth: number; start: string; end: string; last: { start: string; end: string } } {
  const startMonth = useFiscalYearStartMonth();
  const today = todayLocal();
  return useMemo(
    () => ({ startMonth, ...fiscalYearRange(today, startMonth), last: fiscalYearRange(today, startMonth, -1) }),
    [startMonth, today],
  );
}
