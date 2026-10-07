# Inventory in the ledger — Design Spec

**Status:** Implemented 2026-10-07 (migration `0090`). The last serious item from the
2026-09-28 audit (P0 item 7). Three choices in here were made without the firm and are
marked **to confirm**.

## What was actually wrong

The audit said inventory never reached the books. Half of that was already not true:

- **Receiving stock did post.** An item receipt raises and posts a bill: debit the
  item's Inventory account, credit Accounts Payable, at the purchase order's cost.
- **Selling stock posted only the revenue.** Fulfilling a sales order made the invoice
  and reduced the count, but nothing moved the cost out of Inventory, so there was no
  Cost of Goods Sold and gross profit was overstated.
- **Stock entered or changed by hand posted nothing**: opening balances, adjustments,
  write-offs. That is why the demo client's 16,058.65 of stock was 0.00 in the ledger.

## Decisions

- **One place posts.** Every change in stock already goes through
  `stockMovementService.adjustStock`. That function now costs the movement and posts it.
- **Every movement is costed** (`stock_movements.unit_cost`, `total_cost`).
  - Stock coming in takes the cost given (a purchase order's unit cost, or the Unit
    cost box on the item page), else the average cost on hand, else the item's
    purchase cost.
  - Stock going out leaves at the **average cost** of what is on hand. *To confirm:*
    QuickBooks Online uses first-in-first-out; average cost was chosen because it needs
    no record of purchase layers and can be checked by hand.
  - Taking the last of an item takes all of its remaining value, so rounding never
    leaves cents in Inventory.
- **What each movement posts**, for an item that has an Inventory asset account:
  - a receipt: nothing new. Its bill already debited Inventory; the movement is linked
    to that entry so it is not counted twice. (*To confirm:* receipts go through the
    bill, as before, not through a "received not billed" account.)
  - a sale: debit the item's expense (cost of goods sold) account, credit Inventory;
  - an opening balance: debit Inventory, credit Opening Balance Equity;
  - an adjustment, write-off, or stock added or removed by hand: Inventory against the
    item's expense account. (*To confirm:* shrinkage goes to cost of goods sold, not to
    a separate adjustment account.)
- **An item with no Inventory asset account posts nothing.** Its stock is counted but
  not kept in the ledger, as before.
- **An item that is in the ledger needs an expense account** before its stock can be
  sold or adjusted; the error says so.
- **The entries belong to their movement** (`source_id` is the movement). They read
  "Inventory" in the General Ledger, open the item, and cannot be edited on the journal
  entry page. Stock is corrected with another movement.
- **Stock value on the Inventory page** is now the sum of the movements' costs, which
  is the same figure the ledger carries, instead of quantity × the item's current
  purchase cost.

## Stock entered before this

Migration `0090` costs existing movements: receipts at their purchase order's cost and
linked to their bill; everything else at the item's purchase cost, with no journal
entry. Nothing is posted to a client's books automatically.

Inventory → Overview shows what is not yet in the ledger and a **Post opening balance**
button: one journal entry, dated as chosen, debit each Inventory account, credit
Opening Balance Equity. It is an ordinary adjusting entry; deleting it puts the stock
back to "not yet posted".

Past sales in that stock are part of the opening figure rather than restated as cost of
goods sold in their own months.

## Checking it

`npm -w @accounting/api run report:tie-out` has a line for it: posted stock value equals
the balance of the Inventory accounts, and it reports any stock still waiting to be
posted.

## Not built

- Invoices typed in by hand do not move stock; only fulfilling a sales order does.
- Voiding a fulfilled sales order or an item receipt does not put the stock back.
- First-in-first-out costing.
