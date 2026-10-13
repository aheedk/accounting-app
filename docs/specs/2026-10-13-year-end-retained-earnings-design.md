# Year end and Retained Earnings — design

Date: 2026-10-13. From the 10-10 meeting, item 37: Faizan said net income is
not going into Retained Earnings at year end.

## What was wrong

The Balance Sheet already made the year end (since 10-07): this year's profit
on a Net Income line, earlier years' profit added into Retained Earnings. The
Trial Balance and the General Ledger did not. After a year end they showed
income and expense accounts with every year's activity piled together and
Retained Earnings with nothing in it, so the three reports disagreed and an
accountant looking for the year's result in Retained Earnings did not find it.

## The rule

Year end works the way it does in QuickBooks: **nothing is posted.** On the
first day of a fiscal year:

- every income and expense account starts again at zero, and
- the net income (or loss) of all the years before is in Retained Earnings.

Each report works this out from the posted entries as it runs, so it is always
right for the date asked for, there is no closing entry to forget, and changing
an entry in an earlier year changes Retained Earnings by itself. The fiscal
year is the company's own (Setup → Entity), so a July to June company turns
over on July 1.

## Where it shows

| Report | What it does |
|---|---|
| Balance Sheet | Unchanged. Net Income is this fiscal year; Retained Earnings includes the years before |
| Trial Balance | Income and expense accounts show the fiscal year the "as of" date is in. Retained Earnings carries the earlier years: a profit as a credit, a loss as a debit. Debits still equal credits. A line under the report says so, with the amount |
| General Ledger | An income or expense account's beginning balance is the fiscal year so far, zero on the first day of a year. Retained Earnings' beginning balance includes the earlier years |
| Chart of Accounts | Its balances come from the Trial Balance, so they follow |
| Trial Balance export | Same figures as the screen |

Retained Earnings is the account the chart marks as such (`system_key =
'retained_earnings'`), or an equity account named Retained Earnings. A chart
with neither gets a Retained Earnings line on the reports anyway.

The shared pieces are in `apps/api/src/lib/yearEnd.ts`; the Trial Balance is
`ledgerService.computeTrialBalance` and the ledger is
`reports/generalLedgerService.ts`.

## What it does not do

- **There is no closing entry in the journal.** Opening Retained Earnings in
  the General Ledger shows the carried amount as its beginning balance, not as
  a dated line. This is the same in QuickBooks Online.
- **The account's own register** (Chart of Accounts → View register) lists
  posted lines only, so Retained Earnings' register does not show the carried
  amount.
- **A General Ledger that runs across a year end** opens correctly but does not
  reset an income account's running balance part-way down. Run it one fiscal
  year at a time for that.
- **Closing a period** is separate and unchanged: it locks dates against
  posting. It does not move anything.

## To confirm with the firm

Whether this is enough, or whether the firm wants a real closing entry posted
when a year is closed (dated the last day, income and expense to Retained
Earnings). QuickBooks does not post one. If it is wanted, it has to be marked
so the Profit & Loss for that year still shows the year, and it has to be
undone when the year is reopened; that is a larger change.

## Tests

`apps/api/tests/integration/trialBalance.test.ts`, "year end": the year in
progress is left alone; the new year starts income and expense at zero with the
profit in Retained Earnings, matching the Balance Sheet and the General Ledger;
a July fiscal year; a year that lost money.
