# Meeting follow-ups — 2026-10-01

Requests taken from the meeting recording transcript, checked against the code.
Parts of the recording were unclear or not in English, so the last section lists
what could not be made out. Status as of 2026-10-02.

## Done

| # | Request | Where |
|---|---|---|
| 1 | Clicking a Check, Deposit, Expense or Journal Entry in the General Ledger opens that entry's own form | `0106db9`, `e92959e` |
| 2 | Entries "created by a source transaction" go straight to the source instead of a greyed-out page | `e92959e` |
| 3 | Delete a journal entry (QuickBooks "More > Delete") | `1f1382c` |
| 4 | Attachments on entries | `9dd25e2` |
| 5 | Save and post in one step | `f5b200b` |
| 6 | Save / Save and new / Save and close, like QuickBooks | `0b4947d` |
| 7 | Next journal line copies the description above and fills the balancing amount | `4380b5c` |
| 8 | Typing 26 for the year becomes 2026; ledger dates editable on any preset | `0c6a779`, `96b5a86` |
| 9 | Ledger keeps its date range when you go Back from a transaction | `9c3a8bc` |
| 10 | Debit and Credit columns available in the ledger (plus Class, Create Date, Created By, Last Modified) under Customize | `9c3a8bc` |
| 11 | Check number field | `eaed249` |
| 12 | ADJ column can be hidden or filtered | already in place |
| 13 | Name / Memo / Split columns, single signed Amount column | `e92959e` |
| 14 | Dropdowns no longer use the browser's own look | Riham's AppSelect work, `864592f` |

## Open

1. **Credit card statement upload.** In the AI inbox, add a credit card option
   next to bank statement. Pick the credit card account; expenses are
   categorised and the other side goes to that card's payable account.
2. **Bank statements should recognise credit card payments.** A card payment on
   a bank statement belongs in the credit card payable account, not an expense,
   so it matches the card statement. A rule for this exists
   (`autoCodingService.ts`, "Credit card payment") but only fires when the
   client has an account with the "Credit Card" detail type. Needs testing with
   real statements.
3. **Bank Deposit form.** QuickBooks has "+ New > Bank deposit". Ours links to
   the bank transactions page; there is no form to create a deposit.
4. **Vendor dropdown in the AI inbox.** The Name column is free text. It should
   be a dropdown of the client's vendors, with the AI matching the extracted
   name ("Duke Power" to "Duke Energy") and the user able to correct it. Riham
   said "I'll fix that" in the meeting — confirm who owns it.
5. **Chart of Accounts: everything editable.** The edit-account screen should
   allow changing every field, including the account number.

## Bigger items, for later

- **Linking bank and credit card accounts** for daily transaction feeds. Needs
  an outside service (the kind Plaid provides), so an account and credentials
  come before any code.
- **Pay stubs.** Promised for the next meeting. Nothing in the code yet.
- **Reconciliation.** Mentioned in passing; left as something that will follow
  once bank linking exists.
- **Report period presets.** Riham noted the presets were not tested and their
  definitions still need filling in.

## Not code

- **QA audit report in plain English.** Asked for in readable form rather than
  the markdown file, and to walk through it together before fixing anything.
  The report is `docs/qa/2026-09-28-app-audit.md`; its fixes are still deferred.
- **Sample checks for the "Timeout" client**, from the months that already have
  bank statements, for testing.
- **Clean up test entries** added to a real company by mistake. The journal
  entry Delete button makes this possible.
- **Faizan will record a video** of further changes and send it.
- **Match the "+ New" menu to QuickBooks.** Mostly done in Riham's `d418377`.

## Could not make out

- **"Check… payment… payment account"** during the Chart of Accounts part:
  something about the payment account on a check; the request itself is lost.
- **"You don't need like 100 chart of accounts"**: possibly page size, possibly
  the default list of accounts.
- **"Import… first numbers… due to/from"**: something about importing a chart of
  accounts and its account numbers.
- **Acumatica ERP** was named, most likely as a product to look at for reference.
