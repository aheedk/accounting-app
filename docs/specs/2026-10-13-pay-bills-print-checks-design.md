# Printing checks from Pay Bills — design

Date: 2026-10-13. From the 10-10 meeting, item 36: paying bills only marked
them paid. Paying by check should bring up the checks to print on check stock,
as QuickBooks does.

## What it does

**Pay Bills, method Check.** The Reference box becomes **Starting check no.**
It is filled with the next number for the account being paid from and can be
typed over. Paying writes one check per vendor: vendors are taken in name order
and numbered up from the starting number. When it is done the page lists the
checks (number, payee, amount) with three buttons: **Print on check stock**,
**Print on plain paper**, and **Done**. All the checks print as one PDF, a page
each. The bills are paid whether or not anything is printed.

Left blank, the starting number is not required: the bills are paid by check
with no number, for a check written by hand.

**Printing again.** A posted bill payment made by check has the same two print
buttons on its own page (Accounts Payable → Bill Payments → the payment).

**Write Check** has "Print on check stock" next to "Print check".

## Check numbers

A check written from Pay Bills is a bill payment; its check number is the
payment's `reference`. No new column and no migration.

The number sequence belongs to the account the checks are drawn on. The next
number is one more than the highest numeric check number on that account across
all three places a check can come from: Write Check (`checks.check_number`), an
expense paid by check (`expense_transactions.reference`) and a bill payment by
check (`bill_payments.reference`). So a check from Pay Bills and the next one
from Write Check do not collide. `checkService.nextCheckNumberForCashAccount`
does this; `GET /checks/next-number` takes `cash_account_id` (Pay Bills) or
`bank_account_id` (Write Check).

A number already used is not refused, the same as on Write Check.

## The two layouts

- **Plain paper** is the existing layout: a whole check drawn on a blank page
  with the stub under it.
- **Check stock** prints only what goes in the blanks of pre-printed voucher
  stock, one check to a letter page: the check on the top 3.5 inches (date,
  payee, amount in figures, amount in words, the address for a window envelope,
  memo) and a stub on each of the two parts below (payee, date, check number,
  the bills paid, total). The company, the bank and the check number are already
  on the stock, so they are not printed on the check itself. A stub holds nine
  bills; more than that are counted ("and 3 more").

The payee is the vendor's "Name to print on checks" when it has one.

## To confirm with the firm

- **The stock.** The positions follow the usual QuickBooks-compatible voucher
  check. They have not been tried on the firm's stock. They are in one place
  (`CHECK_STOCK` in `apps/web/src/lib/download.ts`): print one on plain paper,
  hold it against a real check, and move the numbers if a field is off.
- **Three checks to a page** (wallet stock) is not built. Say so if the firm
  uses it.
- **"Print later".** QuickBooks can pay now and queue the checks for a later
  print run. Here they are printed straight away, or again from the payment.

## Where the code is

| Part | File |
|---|---|
| Numbering, one check per vendor | `apps/api/src/services/ap/billPaymentService.ts` (`payBills`) |
| Next number for an account | `apps/api/src/services/ap/checkService.ts` |
| The check layouts | `apps/web/src/lib/download.ts` (`buildChecksPdf`) |
| A bill payment as a check | `apps/web/src/lib/billPaymentCheck.ts` |
| The pages | `PayBillsPage.tsx`, `BillPaymentDetailPage.tsx`, `CheckPage.tsx` |

No new route, so nothing changes in the role matrix: Pay Bills is still an
accountant's action.
