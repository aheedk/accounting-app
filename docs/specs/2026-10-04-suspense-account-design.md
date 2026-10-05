# Suspense account for transactions the AI cannot code

Status: Implemented 2026-10-04.

## Why

When the coding engine cannot place a statement line or an invoice line, the
line used to be left blank, and the statement could not be approved until a
person picked an account. Accounting firms instead park unknowns in a
**Suspense** account: the books stay complete (bank balances and
reconciliations are right), the open questions sit in one visible place, and
each is reclassified once the client answers. Suspense should be zero before a
period is closed.

Decision from the firm (2026-10-04): the AI puts unknowns in Suspense
automatically.

## What counts as "unknown"

A line whose coding engine result is **unclassified**: no learned rule,
accounting rule, vendor default, history or AI proposal reached the
`suggested` threshold (70). Lines the engine does suggest (70+) are unchanged:
a person reviews them as before. Reason: anything at 70+ is a reasoned guess
worth showing; below that, a guess is noise, and Suspense is the honest answer.

Also parked: a credit card payment whose source bank account cannot be told,
and a check-stub line only when the stub carries no category (the stub's
category leads otherwise).

## The account

- One per client: **1999 Suspense**, `account_type` asset, `detail_type`
  `Suspense`, `is_system` true (cannot be renamed, recoded or deactivated).
  Found by `detail_type`, never by name. If 1999 is taken, the first free
  199x code.
- Created for every existing business by migration `0082`, and for new
  businesses after the default chart is seeded.
- Hidden from the engine's own choices: not offered to the extraction model in
  the chart of accounts, not matched by the AI layer, and excluded from coding
  history, so parking a vendor in Suspense never teaches the engine to park it
  there again. Approving a Suspense line never creates a learned rule.

## In the AI inbox

Unknown lines arrive preselected to Suspense with a "Suspense — not sure"
badge (`source_layer: 'suspense'`, confidence 0). The reviewer can still pick
the right account before approving. Suspense lines never auto-post.

## Clearing Suspense (AI → Suspense)

A list of every posted entry that still has a Suspense balance: date,
transaction, payee, description, amount, age. For each, pick the right account
and **Reclassify**, optionally ticking **Remember** (teaches the engine for the
vendor, as approving with "remember" does in the inbox).

How a reclassification is recorded:

| Source | How |
|---|---|
| Bank statement line kept as an imported transaction | `updateImportedTransaction`: the category changes in place |
| Expense (check / card / other) | `updateExpense`: the Suspense lines change category (void and repost, as every expense edit) |
| Anything else (deposit, bill, invoice, manual entry) | A reclassification entry (`source_type` adjustment, `source_id` = the original entry) moving the amount from Suspense to the chosen account, dated the original's date |

Every reclassification is stored in `suspense_reclassifications` and audited
(`SUSPENSE_RECLASSIFY`).

## Period close

`closePeriod` refuses while Suspense has a balance as of the period end,
saying how much and pointing at AI → Suspense.
