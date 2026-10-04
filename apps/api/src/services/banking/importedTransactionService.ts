import { type Kysely, type Transaction } from 'kysely';
import { ERR, hasMinRole, toMoneyString } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import type { ServiceCtx } from '../../lib/ctx.js';
import { BusinessRuleError } from '../../lib/errors.js';
import { PreconditionError } from '../../lib/ledgerErrors.js';
import * as ledger from '../core/ledgerService.js';

// A Check / Expense / Deposit posted from a bank statement import. There is no
// row of its own: the journal entry IS the transaction, always two lines with
// the bank account on line 1 (see routes/emailImports.ts).

export type ImportedTransactionType =
  | 'check' | 'expense' | 'deposit'
  // From a credit card statement: money back onto the card.
  | 'credit_card_payment' | 'credit_card_credit';

const INFLOW_TYPES: ReadonlySet<ImportedTransactionType> = new Set(['deposit', 'credit_card_payment', 'credit_card_credit']);

export type ImportedTransaction = {
  id: string;
  journal_number: string;
  status: 'draft' | 'posted' | 'voided';
  entry_date: string;
  transaction_type: ImportedTransactionType;
  /** Money in (deposit) or money out (check / expense). Fixed for the life of the row. */
  direction: 'in' | 'out';
  payee_name: string | null;
  check_number: string | null;
  memo: string | null;
  bank_account_id: string;
  category_account_id: string;
  amount: string;
  can_edit: boolean;
  edit_block_reason: string | null;
};

export type UpdateImportedTransactionInput = {
  journal_entry_id: string;
  entry_date: string;
  transaction_type: ImportedTransactionType;
  payee_name?: string | null;
  check_number?: string | null;
  memo?: string | null;
  bank_account_id: string;
  category_account_id: string;
  amount: string;
};

async function load(db: Kysely<DB>, ctx: ServiceCtx, journalEntryId: string) {
  const businessId = ctx.business_id;
  if (!businessId) throw new BusinessRuleError(ERR.NOT_FOUND, 'Transaction not found');
  const entry = await db.selectFrom('journal_entries as entry')
    .innerJoin('fiscal_periods as period', 'period.id', 'entry.period_id')
    .selectAll('entry')
    .select('period.status as period_status')
    .where('entry.id', '=', journalEntryId)
    .where('entry.business_id', '=', businessId)
    .where('entry.source_type', '=', 'bank_import')
    .executeTakeFirst();
  if (!entry) throw new BusinessRuleError(ERR.NOT_FOUND, 'Transaction not found');
  const lines = await db.selectFrom('journal_entry_lines').selectAll()
    .where('journal_entry_id', '=', entry.id)
    .orderBy('line_number')
    .execute();
  const [bankLine, categoryLine] = lines;
  if (lines.length !== 2 || !bankLine || !categoryLine) {
    throw new PreconditionError('This transaction has been split and can only be viewed as a journal entry');
  }
  return { entry, bankLine, categoryLine, businessId };
}

function editBlockReason(
  ctx: ServiceCtx,
  entry: { status: string; period_status: 'open' | 'closed' },
  hasReversal: boolean,
): string | null {
  if (!hasMinRole(ctx.effective_role, 'accountant')) return 'Accountant access is required to edit transactions.';
  if (entry.status !== 'posted') return 'This transaction is voided and cannot be edited.';
  if (hasReversal) return 'This transaction has already been reversed.';
  if (entry.period_status === 'closed') return 'This transaction is in a closed accounting period.';
  return null;
}

export async function getImportedTransaction(
  db: Kysely<DB>, ctx: ServiceCtx, journalEntryId: string,
): Promise<ImportedTransaction> {
  const { entry, bankLine, categoryLine } = await load(db, ctx, journalEntryId);
  const reversal = await db.selectFrom('journal_entries').select('id')
    .where('business_id', '=', ctx.business_id)
    .where('reversed_entry_id', '=', entry.id)
    .executeTakeFirst();
  const direction = Number(bankLine.debit) > 0 ? 'in' : 'out';
  const blockReason = editBlockReason(ctx, entry, reversal !== undefined);
  const storedType = entry.transaction_type;
  return {
    id: entry.id,
    journal_number: entry.journal_number,
    status: entry.status,
    entry_date: entry.entry_date,
    transaction_type: direction === 'in'
      ? (storedType === 'credit_card_payment' || storedType === 'credit_card_credit' ? storedType : 'deposit')
      : storedType === 'check' ? 'check' : 'expense',
    direction,
    payee_name: entry.payee_name,
    check_number: storedType === 'check' ? entry.reference : null,
    memo: entry.memo,
    bank_account_id: bankLine.account_id,
    category_account_id: categoryLine.account_id,
    amount: direction === 'in' ? bankLine.debit : bankLine.credit,
    can_edit: blockReason === null,
    edit_block_reason: blockReason,
  };
}

export async function updateImportedTransaction(
  trx: Transaction<DB>, ctx: ServiceCtx, input: UpdateImportedTransactionInput,
): Promise<ImportedTransaction> {
  const { entry, bankLine, businessId } = await load(trx, ctx, input.journal_entry_id);
  if (!entry.source_id) throw new PreconditionError('This transaction is not linked to an import');

  const direction = Number(bankLine.debit) > 0 ? 'in' : 'out';
  // Money in stays a deposit and money out stays a check/expense -- flipping
  // direction would be a different transaction, not a correction.
  if ((direction === 'in') !== INFLOW_TYPES.has(input.transaction_type)) {
    throw new PreconditionError(
      direction === 'in'
        ? 'A deposit cannot be changed into a check or expense'
        : 'A check or expense cannot be changed into a deposit',
    );
  }
  if (input.bank_account_id === input.category_account_id) {
    throw new PreconditionError('Category and bank account must be different accounts');
  }
  const bank = await trx.selectFrom('chart_of_accounts').select(['id', 'account_type'])
    .where('id', '=', input.bank_account_id)
    .where('business_id', '=', ctx.business_id)
    .executeTakeFirst();
  if (!bank) throw new BusinessRuleError(ERR.NOT_FOUND, 'Bank account not found');
  if (bank.account_type !== 'asset' && bank.account_type !== 'liability') {
    throw new PreconditionError('The bank account must be an asset (bank) or liability (credit card) account');
  }

  const amount = toMoneyString(input.amount);
  const zero = toMoneyString('0');
  const memo = input.memo?.trim() || null;
  const isCheck = input.transaction_type === 'check';
  // The check number lives in `reference` (the GL "Num" column). A reference
  // on a non-check is left alone unless the row is being changed from a check.
  const reference = isCheck
    ? (input.check_number?.trim() || null)
    : entry.transaction_type === 'check' ? null : entry.reference;

  await ledger.updateJournalEntry(trx, ctx, {
    journal_entry_id: entry.id,
    source_guard: { source_type: 'bank_import', source_id: entry.source_id },
    replacement: {
      business_id: businessId,
      entry_date: input.entry_date,
      source_type: 'bank_import',
      source_id: entry.source_id,
      transaction_type: input.transaction_type,
      payee_name: direction === 'in' ? entry.payee_name : (input.payee_name?.trim() || null),
      memo,
      reference,
      lines: [
        {
          account_id: input.bank_account_id,
          debit: direction === 'in' ? amount : zero,
          credit: direction === 'in' ? zero : amount,
          memo,
        },
        {
          account_id: input.category_account_id,
          debit: direction === 'in' ? zero : amount,
          credit: direction === 'in' ? amount : zero,
          memo,
        },
      ],
    },
  });
  return getImportedTransaction(trx, ctx, entry.id);
}
