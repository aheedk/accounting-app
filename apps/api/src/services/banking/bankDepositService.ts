import { type Transaction, type Kysely } from 'kysely';
import { AUDIT } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import type { ServiceCtx } from '../../lib/ctx.js';
import * as ledger from '../core/ledgerService.js';
import { record as auditRecord } from '../audit/auditService.js';
import { nextCounter } from '../core/numberingService.js';
import { NotFoundError } from '../../lib/errors.js';

export type DepositLineInput = {
  received_from?: string | null;
  account_id?: string | null;
  description?: string | null;
  payment_method?: string | null;
  ref_no?: string | null;
  amount: string;
  sort_order?: number;
};

export type CreateDepositInput = {
  bank_account_id: string;
  deposit_date: string;
  memo?: string | null;
  lines: DepositLineInput[];
  cash_back_account_id?: string | null;
  cash_back_memo?: string | null;
  cash_back_amount?: string | null;
};

export type UpdateDepositInput = Partial<CreateDepositInput>;

export async function createDeposit(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: CreateDepositInput,
) {
  const bizId = ctx.business_id!;

  const bankAccount = await trx.selectFrom('bank_accounts')
    .innerJoin('chart_of_accounts as coa', 'coa.id', 'bank_accounts.cash_account_id')
    .select(['bank_accounts.id', 'bank_accounts.cash_account_id', 'coa.name as account_name'])
    .where('bank_accounts.id', '=', input.bank_account_id)
    .where('bank_accounts.business_id', '=', bizId)
    .executeTakeFirst();
  if (!bankAccount) throw new NotFoundError('bank_account', input.bank_account_id);

  const linesTotal = input.lines.reduce((sum, l) => sum + parseFloat(l.amount), 0);
  const cashBack = parseFloat(input.cash_back_amount ?? '0') || 0;
  const netTotal = linesTotal - cashBack;

  const counter = await nextCounter(trx, bizId, 'bank_deposit');
  const deposit_number = `DEP-${String(counter).padStart(4, '0')}`;

  const deposit = await trx.insertInto('bank_deposits').values({
    business_id: bizId,
    bank_account_id: input.bank_account_id,
    deposit_date: input.deposit_date,
    deposit_number,
    memo: input.memo ?? null,
    total_amount: netTotal.toFixed(2),
    cash_back_account_id: input.cash_back_account_id ?? null,
    cash_back_memo: input.cash_back_memo ?? null,
    cash_back_amount: input.cash_back_amount ?? null,
  }).returningAll().executeTakeFirstOrThrow();

  if (input.lines.length > 0) {
    await trx.insertInto('bank_deposit_lines').values(
      input.lines.map((l, i) => ({
        deposit_id: deposit.id,
        business_id: bizId,
        received_from: l.received_from ?? null,
        account_id: l.account_id ?? null,
        description: l.description ?? null,
        payment_method: l.payment_method ?? null,
        ref_no: l.ref_no ?? null,
        amount: l.amount,
        sort_order: l.sort_order ?? i,
      })),
    ).execute();
  }

  // Build JE lines: CR each deposit line account, DR bank account
  const jeLines: ledger.LineInput[] = [];

  for (const line of input.lines) {
    if (!line.account_id || parseFloat(line.amount) === 0) continue;
    jeLines.push({
      account_id: line.account_id,
      debit: '0',
      credit: parseFloat(line.amount).toFixed(2),
      memo: line.description ?? null,
    });
  }

  // Cash back: DR the cash back account
  if (input.cash_back_account_id && cashBack > 0) {
    jeLines.push({
      account_id: input.cash_back_account_id,
      debit: cashBack.toFixed(2),
      credit: '0',
      memo: input.cash_back_memo ?? null,
    });
  }

  // DR bank account for net amount
  if (netTotal !== 0) {
    jeLines.push({
      account_id: bankAccount.cash_account_id,
      debit: netTotal > 0 ? netTotal.toFixed(2) : '0',
      credit: netTotal < 0 ? Math.abs(netTotal).toFixed(2) : '0',
      memo: input.memo ?? null,
    });
  }

  let journalEntryId: string | null = null;
  if (jeLines.length >= 2) {
    const je = await ledger.postJournalEntry(trx, ctx, {
      business_id: bizId,
      entry_date: input.deposit_date,
      source_type: 'bank_deposit',
      source_id: deposit.id,
      transaction_type: 'deposit',
      memo: input.memo ?? null,
      lines: jeLines,
    });
    journalEntryId = je.id;
    await trx.updateTable('bank_deposits')
      .set({ journal_entry_id: je.id })
      .where('id', '=', deposit.id)
      .execute();
  }

  await auditRecord(trx, ctx, {
    action: AUDIT.BANK_DEPOSIT_CREATE,
    entity_type: 'bank_deposit',
    entity_id: deposit.id,
    before: null,
    after: { ...deposit, journal_entry_id: journalEntryId },
  });

  return { ...deposit, journal_entry_id: journalEntryId };
}

export async function getDeposit(db: Kysely<DB>, ctx: ServiceCtx, id: string) {
  const deposit = await db.selectFrom('bank_deposits as d')
    .innerJoin('bank_accounts as ba', 'ba.id', 'd.bank_account_id')
    .innerJoin('chart_of_accounts as coa', 'coa.id', 'ba.cash_account_id')
    .select([
      'd.id', 'd.business_id', 'd.bank_account_id', 'd.deposit_date',
      'd.deposit_number', 'd.memo', 'd.total_amount', 'd.journal_entry_id',
      'd.cash_back_account_id', 'd.cash_back_memo', 'd.cash_back_amount',
      'd.created_at', 'd.updated_at',
      'ba.name as bank_account_name',
      'coa.name as cash_account_name',
    ])
    .where('d.id', '=', id)
    .where('d.business_id', '=', ctx.business_id!)
    .executeTakeFirst();
  if (!deposit) throw new NotFoundError('bank_deposit', id);

  const lines = await db.selectFrom('bank_deposit_lines as l')
    .leftJoin('chart_of_accounts as a', 'a.id', 'l.account_id')
    .select([
      'l.id', 'l.deposit_id', 'l.received_from', 'l.account_id',
      'l.description', 'l.payment_method', 'l.ref_no', 'l.amount', 'l.sort_order',
      'a.name as account_name', 'a.code as account_code',
    ])
    .where('l.deposit_id', '=', id)
    .orderBy('l.sort_order', 'asc')
    .execute();

  return { ...deposit, lines };
}

export async function listDeposits(db: Kysely<DB>, ctx: ServiceCtx) {
  return db.selectFrom('bank_deposits as d')
    .innerJoin('bank_accounts as ba', 'ba.id', 'd.bank_account_id')
    .select([
      'd.id', 'd.deposit_date', 'd.deposit_number', 'd.memo',
      'd.total_amount', 'd.bank_account_id', 'ba.name as bank_account_name',
      'd.journal_entry_id', 'd.created_at',
    ])
    .where('d.business_id', '=', ctx.business_id!)
    .orderBy('d.deposit_date', 'desc')
    .execute();
}

export async function deleteDeposit(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  id: string,
) {
  const before = await trx.selectFrom('bank_deposits')
    .selectAll()
    .where('id', '=', id)
    .where('business_id', '=', ctx.business_id!)
    .executeTakeFirst();
  if (!before) throw new NotFoundError('bank_deposit', id);

  if (before.journal_entry_id) {
    await ledger.voidJournalEntry(trx, ctx, {
      journal_entry_id: before.journal_entry_id,
      void_reason: `Bank deposit ${before.deposit_number} deleted`,
    });
  }

  await trx.deleteFrom('bank_deposits').where('id', '=', id).execute();

  await auditRecord(trx, ctx, {
    action: AUDIT.BANK_DEPOSIT_DELETE,
    entity_type: 'bank_deposit',
    entity_id: id,
    before,
    after: null,
  });
}
