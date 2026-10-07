# Inventory in the ledger — Proposal

**Status:** Proposed 2026-10-07. **Not built.** It needs three answers from the firm
first, because each one changes the numbers on the balance sheet and the P&L.
This is the one serious item left from the 2026-09-28 audit (P0 item 7).

## The problem

Inventory is tracked by quantity and cost, but nothing it does reaches the books:

- The Inventory page values stock (16,058.65 on the demo client); the Inventory
  account in the ledger is 0.00.
- Receiving stock creates no payable.
- Selling stock records no cost of goods sold, so gross profit is overstated.

No inventory service posts a journal entry today.

## What has to be decided

1. **How a receipt reaches the books.**
   - *Recommended: through the bill.* A bill line can name an inventory item; posting
     the bill debits Inventory (not an expense) and credits Accounts Payable. This is
     how QuickBooks Online works and needs no new account.
   - *Alternative: on the item receipt,* crediting a "received not billed" liability,
     with the bill clearing it later. More accurate when goods arrive before the bill,
     but every bill then has to be matched to a receipt.
2. **How cost is worked out when stock is sold.**
   - *Recommended: average cost.* One running cost per item; simple to explain and to
     check.
   - *Alternative: first in, first out,* which QuickBooks Online uses. It needs a
     record of every purchase layer and is harder to audit by hand.
3. **What to do with stock already on hand.** The quantities and costs entered so far
   were never posted. Either post one opening entry per client (debit Inventory,
   credit Opening Balance Equity) on a chosen date, or start from zero and re-enter.

## What would be built once those are answered

- Invoice and bill lines carry the inventory item and quantity (today an invoice line
  only borrows the item's income account).
- Posting a bill with item lines: debit Inventory, credit Accounts Payable.
- Posting an invoice with item lines: the usual revenue entry, plus debit Cost of
  Goods Sold, credit Inventory at the item's cost.
- A stock adjustment: debit or credit Inventory against an adjustment account.
- Voiding or deleting any of these reverses its stock and its cost.
- A check, like the report tie-out, that the Inventory page's value equals the
  Inventory account.

It touches invoices, bills, the ledger and three inventory services, so it is a slice
of its own, not a fix.
