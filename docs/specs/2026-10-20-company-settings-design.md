# Company settings — design

**Date:** 2026-10-20. From `docs/backlog.md` ("Setup and admin settings") and the
10-16 follow-ups. A client's own defaults, set once per company, the way
QuickBooks keeps them under Account and settings → Sales and Expenses. Before
November 1, when the firm's real clients start, each client needs its own
invoice numbering and terms.

## The page

Setup → **Company Settings** (`/setup/company-settings`). Two cards, one Save:

| Card | Setting | Default | Used by |
|---|---|---|---|
| Sales | Invoice number prefix, e.g. `INV-` (letters, digits, dash; up to 10) | none | every invoice the app numbers |
| Sales | Start invoice numbers at | 1001 | the same |
| Sales | Default terms for invoices | Net 30 | a new invoice before a customer is picked; a new customer |
| Sales | Default sales tax | none | the tax box on a new invoice |
| Expenses | Default terms for bills | Net 30 | a new bill before a vendor is picked; a new vendor |
| Expenses | Default payment method | Cash | the method on a new expense |

Only a firm admin changes them, through the same `PATCH /businesses/:id` the
Entity page uses (already firm admin only), so the change is in the Activity
Log as a business update. Anyone who can open the company reads them, with the
business.

## Invoice numbers: one rule

Until now two rules numbered invoices. The invoice form suggested the highest
number so far plus one, reading the digits out of every number (so a corrected
`1042-R1` read as 10421 and the next suggestion jumped to 10422). Recurring
invoices and invoices made from a sales order took a separate counter and came
out as `INV-0001`, so one company could hold both styles.

Now `invoiceService.getNextInvoiceNumber` is the one rule, used by the form, the
customer purchase order import, recurring invoices and sales orders:

- Look only at invoices whose number is the prefix followed by digits alone.
  Anything else (`-R1` corrections, numbers typed by hand in another style) is
  left out.
- The next number is the highest of those plus one, but never below "start
  invoice numbers at".
- The result is the prefix and the number, e.g. `INV-1043`.

Changing the prefix starts a fresh sequence at "start at"; the invoices already
numbered keep their numbers. A typed number still wins on the form, and the
duplicate check on save is unchanged.

Bills, purchase orders and sales orders keep their own numbering. A bill
usually carries the vendor's invoice number, typed in.

## Data

Migration `0103_company_settings.sql` adds to `businesses`:

| Column | Type |
|---|---|
| `invoice_number_prefix` | `text NOT NULL DEFAULT ''`, `^[A-Za-z0-9-]{0,10}$` |
| `invoice_next_number` | `bigint NULL` (NULL means 1001), 1 to 999,999,999 |
| `default_invoice_terms_days` | `int NOT NULL DEFAULT 30`, 0 to 365 |
| `default_bill_terms_days` | `int NOT NULL DEFAULT 30`, 0 to 365 |
| `default_sales_tax_code_id` | `uuid NULL`, this company's tax code |
| `default_expense_payment_method` | `text NOT NULL DEFAULT 'cash'`, one of the expense methods |

The defaults are what the app did before, so nothing changes for a company until
someone edits its settings. The tax code must be the company's own (checked in
`businessService.updateBusiness`).

A customer or vendor created without terms takes the company's default instead
of the column's fixed 30, wherever it is created (Add new from a picker, an
import); the New customer and New vendor forms start their Terms box on it.

The bill form used to start at Due on receipt until a vendor was picked; it now
starts at the company's bill terms (Net 30 unless changed), which is also what
a new vendor gets.

## Out of scope

- Numbering settings for bills, purchase orders and sales orders.
- Preferred delivery (email or print), late fees, deposits, discounts and the
  other QuickBooks Sales settings.
- Showing a message to the customer on invoices.
