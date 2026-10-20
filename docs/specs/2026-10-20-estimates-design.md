# Estimates — design

**Date:** 2026-10-20. Item 17 of the meeting notes: the last transaction type
the QA audit (`docs/qa/2026-09-28-app-audit.md`, finding 9) found missing. A
quote to a customer, the way QuickBooks keeps one: it is sent, accepted or
turned down, and when the work goes ahead it becomes an invoice. Nothing about
an estimate is in the books until it is an invoice.

## What an estimate holds

| Field | Notes |
|---|---|
| Estimate no. | `EST-0001`, `EST-0002`… from the company's own counter (`numbering_counters`, entity `estimate`), the way sales orders (`SO-`) and purchase orders (`PO-`) are numbered. Not typed. |
| Customer | One of this company's customers. |
| Estimate date | |
| Expiration date | Optional; never before the estimate date. |
| Message to customer | The `memo`; printed on the PDF. |
| Lines | Product/service, description, quantity, rate, and the sales tax picked for the estimate. |
| Status | Pending, Accepted, Rejected or Closed (below). |
| Accepted by, accepted date | Filled when it is marked Accepted, as QuickBooks asks. |
| Invoice | The invoice it became, once Closed. |

A line keeps the income account of its product (as an invoice line does, so
the estimate can become an invoice without asking for anything more) and the
product itself, so the form can show it again. Totals and tax are worked out by
the API with the invoice's own rule (`invoiceService.computeLine`, the tax
rate in force on the estimate date). A tax code, product, account or customer
from another company is refused.

## Status

| Status | How it gets there | What can happen next |
|---|---|---|
| Pending | New | Edit; mark Accepted or Rejected; make the invoice |
| Accepted | Marked, with who accepted it and when | Edit; back to Pending; make the invoice |
| Rejected | Marked | Edit; back to Pending |
| Closed | The invoice was made | Nothing: it is kept as it was |

**Expired** is shown, not stored: a Pending estimate past its expiration date
reads "Expired" in the list and on the page, as in QuickBooks. It can still be
accepted or turned into an invoice; the date is a promise to the customer, not
a lock.

A Rejected estimate is not turned into an invoice; set it back to Pending (or
Accepted) first, so the change of mind is on record.

## Turning it into an invoice

`POST /businesses/:id/estimates/:estimateId/convert` (staff and up), in one
transaction:

1. Makes a **draft** invoice for the estimate's customer with the estimate's
   lines (description, quantity, rate, income account, tax code). The number is
   the company's next invoice number (`getNextInvoiceNumber`, Company
   Settings); the invoice date is today unless one is sent; the terms and due
   date follow the customer's default terms; the message carries over.
2. Marks the estimate Closed, with the invoice's id.

The invoice is a draft so that posting it stays an accountant's step, the same
as any invoice staff enter. The page opens the new invoice, where an accountant
posts it. The invoice page names the estimate it came from.

Tax is worked out again on the invoice date, so a rate that changed in between
is charged at the new rate, as on any invoice.

QuickBooks also invoices part of an estimate (progress invoicing). Not built:
the whole estimate becomes one invoice.

## Changing and deleting

- An estimate is edited (header and lines together) until it is Closed.
- Deleting is for a firm admin, like every delete in the app, and only while it
  is not Closed: a Closed estimate's invoice points back at it. A Rejected
  estimate is usually better kept than deleted.

## Who can do what

| | Client | View only | Staff | Accountant | Firm admin |
|---|---|---|---|---|---|
| See estimates | — | ✓ | ✓ | ✓ | ✓ |
| Make, edit, accept/reject, make the invoice | — | — | ✓ | ✓ | ✓ |
| Delete | — | — | — | — | ✓ |

A client login does not see estimates (not in `clientAccess.ts`). Estimates are
not in the approval step (`HELD_ACTIONS`): nothing posts, and the invoice made
from one is a draft.

## API

| Route | Role |
|---|---|
| `GET ~/estimates` (`?status=`, `?customer_id=`) | reads |
| `GET ~/estimates/:id` → `{ estimate, lines, invoice_number }` | reads |
| `POST ~/estimates` | staff |
| `PATCH ~/estimates/:id` (the whole estimate again) | staff |
| `POST ~/estimates/:id/status` `{ status, accepted_by?, accepted_date? }` | staff |
| `POST ~/estimates/:id/convert` `{ issue_date? }` → `{ estimate, invoice }` | staff |
| `DELETE ~/estimates/:id` | firm admin |

Audit actions: `estimate.create`, `estimate.update`, `estimate.status`,
`estimate.convert`, `estimate.delete`.

`GET ~/invoices/:id` also returns `estimate: { id, estimate_number } | null`.

## Pages

- **Accounts Receivable → Estimates** (`/estimates`): the list, newest first,
  with a status filter (Expired included), Excel and print, and "Create
  invoice" on each open estimate.
- **+ New → Estimate** (`/estimates/new`, also from a customer's page with the
  customer picked): customer, estimate and expiration dates, message, and the
  lines with quantity and rate, tax and totals. The same form edits one
  (`/estimates/:id/edit`).
- **The estimate** (`/estimates/:id`): its lines and totals, Accept (asks who
  accepted it), Reject, Create invoice, Edit, Save as PDF, Delete.
- **Search** finds an estimate by its number or the customer's name.
- **A customer's page** lists the customer's estimates and has New estimate.
- **Save as PDF** prints it like the invoice PDF, headed ESTIMATE, with the
  expiration date and the total (no balance due).

## Not built

- Emailing an estimate from the app waits on item 47, as invoices do. The PDF
  is sent by hand meanwhile.
- The customer accepting online.
- Progress invoicing (part of an estimate at a time).
- Estimates in Accounting → Transactions, which lists what is in the books.
