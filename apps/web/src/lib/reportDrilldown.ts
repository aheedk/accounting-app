export const LEDGER_HISTORY_START = '1900-01-01';

export function generalLedgerDrilldownUrl({
  accountId,
  periodStart,
  periodEnd,
}: {
  accountId: string;
  periodStart: string;
  periodEnd: string;
}): string {
  const params = new URLSearchParams({
    account_id: accountId,
    period_start: periodStart,
    period_end: periodEnd,
  });
  return `/reports/general-ledger?${params.toString()}`;
}
