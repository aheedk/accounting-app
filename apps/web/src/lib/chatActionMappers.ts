import type { schemas } from '@accounting/shared';
import type { JournalEntryFormValues } from '@/pages/journal/journalEntryForm';

/**
 * Where a chat `action` payload's "open in the full form" button sends the
 * user — the real create page for that transaction type, never a route this
 * feature owns itself. The chat assistant only gets as far as handing the
 * draft to that page via router state (`chatDraft`); the page's own existing
 * save/post button is still what actually writes anything.
 */
export function chatActionRoute(action: schemas.ChatActionPayload): string {
  switch (action.type) {
    case 'journal_entry': return '/journal/new';
    case 'expense': return '/accounting/expenses/new';
    case 'invoice': return '/invoices/new';
    case 'deposit': return '/accounting/bank-deposits/new';
  }
}

/** Maps a chat-drafted journal entry straight into the editor's own form
 * shape — no fake ids needed, unlike `copySource`/`existing`, since a draft
 * that was never saved has none to fabricate. An unmatched line (no
 * `account_id`) is left blank for the user to pick, with the model's guess
 * at the name kept in the line's own "name" field as a hint. */
export function chatToJournalForm(action: schemas.JournalEntryAction): JournalEntryFormValues {
  return {
    date: action.data.date,
    journalNo: '',
    reference: '',
    isAdjusting: false,
    memo: action.data.memo ?? '',
    lines: [
      ...action.data.lines.map(l => ({
        account_id: l.account_id ?? '',
        debit: l.debit ? l.debit.toFixed(2) : '',
        credit: l.credit ? l.credit.toFixed(2) : '',
        description: l.description ?? '',
        name: l.account_id ? '' : l.account_name,
        class_name: '',
      })),
      { account_id: '', debit: '', credit: '', description: '', name: '', class_name: '' },
    ],
  };
}

/**
 * Builds a draft the same shape the chatbot's action pre-fill already uses,
 * from an unmatched bank-statement line in the reconciliation review — an
 * inflow becomes a deposit draft, an outflow an expense draft, both already
 * knowing the payment/deposit-to account (the one being reconciled), which
 * the chatbot itself never has. Reuses `chatActionRoute`/`ChatDraftState`
 * unchanged, so the 4 create pages need no reconciliation-specific code at
 * all — they already know how to read a `ChatActionPayload` draft.
 */
export function statementLineToCreateDraft(
  line: { date: string; description: string; amount: string },
  account: { id: string; name: string },
): schemas.ChatActionPayload {
  const amount = Math.abs(Number(line.amount));
  const isInflow = Number(line.amount) >= 0;
  return isInflow
    ? {
        type: 'deposit',
        data: {
          date: line.date,
          deposit_to_account_id: account.id,
          memo: line.description,
          lines: [{ account_id: null, account_name: '', amount, description: line.description }],
        },
      }
    : {
        type: 'expense',
        data: {
          date: line.date,
          payment_account_id: account.id,
          vendor_name: line.description,
          memo: line.description,
          lines: [{ account_id: null, account_name: '', amount, description: line.description }],
        },
      };
}

export function chatActionLabel(action: schemas.ChatActionPayload): string {
  switch (action.type) {
    case 'journal_entry': return 'Journal entry';
    case 'expense': return 'Expense';
    case 'invoice': return 'Invoice';
    case 'deposit': return 'Deposit';
  }
}
