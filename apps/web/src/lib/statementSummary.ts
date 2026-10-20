import { parseStatementAmount } from '@accounting/shared';

// The AI inbox's statement summary form (item 72).

/** The statement's period and balances as the reviewer leaves them; '' for none. */
export type SummaryForm = { period_start: string; period_end: string; beginning_balance: string; ending_balance: string };
export const NO_SUMMARY: SummaryForm = { period_start: '', period_end: '', beginning_balance: '', ending_balance: '' };

/** What the AI read off the statement (null where it could not), as the form starts. */
export function summaryFormOf(read: {
  period_start?: string | null; period_end?: string | null;
  beginning_balance?: string | null; ending_balance?: string | null;
}): SummaryForm {
  return {
    period_start: read.period_start?.slice(0, 10) ?? '',
    period_end: read.period_end?.slice(0, 10) ?? '',
    beginning_balance: parseStatementAmount(read.beginning_balance) ?? '',
    ending_balance: parseStatementAmount(read.ending_balance) ?? '',
  };
}
