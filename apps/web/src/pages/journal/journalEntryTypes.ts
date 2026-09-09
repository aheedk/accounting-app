export type JournalEntryStatus = 'draft' | 'posted' | 'voided';

export type JournalEntrySourceType =
  | 'manual'
  | 'invoice'
  | 'payment'
  | 'credit_memo'
  | 'bill'
  | 'bill_payment'
  | 'vendor_credit'
  | 'reversal'
  | 'adjustment';

export type JournalEntryLine = {
  id: string;
  journal_entry_id: string;
  line_number: number;
  account_id: string;
  account_code: string;
  account_name: string;
  debit: string;
  credit: string;
  memo: string | null;
  name: string | null;
  class_name: string | null;
};

export type JournalEntryRecord = {
  id: string;
  business_id: string;
  period_id: string;
  entry_date: string;
  memo: string | null;
  reference: string | null;
  journal_number: string;
  status: JournalEntryStatus;
  source_type: JournalEntrySourceType;
  source_id: string | null;
  reversed_entry_id: string | null;
  corrected_from_entry_id: string | null;
  posted_at: string | null;
  posted_by_user_id: string | null;
  voided_at: string | null;
  voided_by_user_id: string | null;
  void_reason: string | null;
  created_at: string;
  created_by_user_id: string | null;
  updated_at: string;
};

export type JournalEntryListItem = JournalEntryRecord & {
  lines: JournalEntryLine[];
};

export type JournalEntryDetail = {
  entry: JournalEntryRecord & { period_status: 'open' | 'closed' };
  lines: JournalEntryLine[];
  can_correct: boolean;
  correction_block_reason: string | null;
  can_reverse: boolean;
  reversal_block_reason: string | null;
  is_standalone_manual: boolean;
};
