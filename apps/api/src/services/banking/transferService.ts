import { type Transaction } from 'kysely';
import type { DB } from '../../db/types.js';
import type { ServiceCtx } from '../../lib/ctx.js';
import * as ledger from '../core/ledgerService.js';
import { NotFoundError } from '../../lib/errors.js';
import { PreconditionError } from '../../lib/ledgerErrors.js';

// A transfer moves money between two of a client's own balance sheet accounts.
// It is posted as an ordinary journal entry tagged as a transfer, so it shows
// as "Transfer" in the General Ledger and is opened, edited, voided and deleted
// on the journal entry page like any other entry; it has no table of its own.

export type CreateTransferInput = {
  from_account_id: string;
  to_account_id: string;
  amount: string;
  transfer_date: string;
  memo?: string | null;
};

const BALANCE_SHEET_TYPES = ['asset', 'liability', 'equity'];

export async function createTransfer(trx: Transaction<DB>, ctx: ServiceCtx, input: CreateTransferInput) {
  const businessId = ctx.business_id;
  if (!businessId) throw new PreconditionError('No business selected');
  if (input.from_account_id === input.to_account_id) {
    throw new PreconditionError('Choose two different accounts to transfer between');
  }
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new PreconditionError('Transfer amount must be above zero');

  const accounts = await trx.selectFrom('chart_of_accounts')
    .select(['id', 'name', 'account_type', 'is_active'])
    .where('business_id', '=', businessId)
    .where('id', 'in', [input.from_account_id, input.to_account_id])
    .execute();
  const from = accounts.find(a => a.id === input.from_account_id);
  const to = accounts.find(a => a.id === input.to_account_id);
  if (!from) throw new NotFoundError('account', input.from_account_id);
  if (!to) throw new NotFoundError('account', input.to_account_id);
  for (const account of [from, to]) {
    if (!account.is_active) throw new PreconditionError(`${account.name} is inactive`);
    // Income and expense accounts are categories, not places money sits.
    if (!BALANCE_SHEET_TYPES.includes(account.account_type)) {
      throw new PreconditionError(`${account.name} is an income or expense account. A transfer moves money between balance sheet accounts; use an expense or a journal entry instead.`);
    }
  }

  const value = amount.toFixed(4);
  const memo = input.memo?.trim() || `Transfer from ${from.name} to ${to.name}`;
  return ledger.postJournalEntry(trx, ctx, {
    business_id: businessId,
    entry_date: input.transfer_date,
    source_type: 'manual',
    transaction_type: 'transfer',
    memo,
    lines: [
      { account_id: to.id, debit: value, credit: '0.0000', memo },
      { account_id: from.id, debit: '0.0000', credit: value, memo },
    ],
  });
}
