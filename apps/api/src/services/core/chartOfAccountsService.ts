import { Kysely, sql, type Transaction } from 'kysely';
import { AUDIT, ERR, SUSPENSE_DETAIL_TYPE, addMoney, subMoney, toMoneyString, isZero } from '@accounting/shared';
import type { DB, AccountType } from '../../db/types.js';
import { BusinessRuleError } from '../../lib/errors.js';
import { PreconditionError } from '../../lib/ledgerErrors.js';
import { record as auditRecord } from '../audit/auditService.js';
import { postJournalEntry } from './ledgerService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type CreateAccountInput = {
  business_id: string;
  code: string;
  name: string;
  account_type: AccountType;
  parent_id: string | null;
  detail_type?: string | null;
  description?: string | null;
  // QBO-style opening balance: posts a JE against Opening Balance Equity.
  opening_balance?: string | null;
  opening_balance_as_of?: string | null;
  // Locked accounts reject edits and new postings until unlocked.
  is_locked?: boolean;
};

// QBO auto-creates "Opening Balance Equity" the first time an opening balance
// is entered. Find it by name, else create it at the first free 39xx code.
async function getOrCreateOpeningBalanceEquity(trx: Transaction<DB>, ctx: ServiceCtx, business_id: string) {
  const existing = await trx.selectFrom('chart_of_accounts').selectAll()
    .where('business_id', '=', business_id)
    .where('name', '=', 'Opening Balance Equity')
    .where('account_type', '=', 'equity')
    .executeTakeFirst();
  if (existing) return existing;

  const taken = new Set(
    (await trx.selectFrom('chart_of_accounts').select('code')
      .where('business_id', '=', business_id)
      .where('code', 'like', '39%')
      .execute()).map(r => r.code),
  );
  let code = '3900';
  for (let n = 3900; n <= 3999 && taken.has(code); n++) code = String(n + 1);
  if (taken.has(code)) throw new PreconditionError('No free 39xx code for Opening Balance Equity');

  return createAccount(trx, ctx, {
    business_id, code, name: 'Opening Balance Equity', account_type: 'equity',
    parent_id: null, detail_type: 'Opening Balance Equity',
  });
}

export async function createAccount(trx: Transaction<DB>, ctx: ServiceCtx, input: CreateAccountInput) {
  const dup = await trx.selectFrom('chart_of_accounts')
    .select('id')
    .where('business_id', '=', input.business_id)
    .where('code', '=', input.code)
    .executeTakeFirst();
  if (dup) throw new BusinessRuleError(ERR.DUPLICATE_RESOURCE, `Account code ${input.code} already exists`);

  // Insert unlocked even when a lock is requested — the opening-balance JE
  // below must post before the lock takes effect. The lock is applied last.
  let row = await trx.insertInto('chart_of_accounts').values({
    business_id: input.business_id,
    code: input.code,
    name: input.name,
    account_type: input.account_type,
    parent_id: input.parent_id,
    detail_type: input.detail_type ?? null,
    description: input.description ?? null,
  }).returningAll().executeTakeFirstOrThrow();

  if (input.opening_balance != null && !isZero(input.opening_balance)) {
    // Opening balances only make sense for balance-sheet accounts.
    if (input.account_type === 'revenue' || input.account_type === 'expense') {
      throw new PreconditionError('Opening balances apply to balance-sheet accounts only', { code: input.code });
    }
    const obe = await getOrCreateOpeningBalanceEquity(trx, ctx, input.business_id);
    const amount = toMoneyString(input.opening_balance);
    const negative = amount.startsWith('-');
    const abs = negative ? toMoneyString(amount.slice(1)) : amount;
    // Positive OB increases the account in its natural sign; the offset lands
    // on Opening Balance Equity. Negative OB flips the pair.
    const debitNormal = input.account_type === 'asset';
    const accountGetsDebit = debitNormal !== negative;
    await postJournalEntry(trx, ctx, {
      business_id: input.business_id,
      entry_date: input.opening_balance_as_of ?? new Date().toISOString().slice(0, 10),
      source_type: 'adjustment', // enum has no 'opening_balance'; memo carries intent
      source_id: row.id,
      memo: `Opening balance for ${row.code} ${row.name}`,
      lines: accountGetsDebit
        ? [
            { account_id: row.id, debit: abs, credit: '0.0000', memo: null },
            { account_id: obe.id, debit: '0.0000', credit: abs, memo: null },
          ]
        : [
            { account_id: row.id, debit: '0.0000', credit: abs, memo: null },
            { account_id: obe.id, debit: abs, credit: '0.0000', memo: null },
          ],
    });
  }

  if (input.is_locked) {
    row = await trx.updateTable('chart_of_accounts')
      .set({ is_locked: true })
      .where('id', '=', row.id)
      .returningAll().executeTakeFirstOrThrow();
  }

  await auditRecord(trx, ctx, {
    action: AUDIT.COA_CREATE,
    entity_type: 'chart_of_account',
    entity_id: row.id,
    before: null,
    after: row,
  });

  return row;
}

export type AccountPatch = {
  code?: string;
  name?: string;
  account_type?: AccountType;
  parent_id?: string | null;
  is_active?: boolean;
  detail_type?: string | null;
  description?: string | null;
  is_locked?: boolean;
};

export async function updateAccount(
  trx: Transaction<DB>, ctx: ServiceCtx,
  input: { account_id: string; patch: AccountPatch },
) {
  const row = await trx.selectFrom('chart_of_accounts').selectAll()
    .where('id', '=', input.account_id).executeTakeFirst();
  if (!row) throw new BusinessRuleError(ERR.NOT_FOUND, `Account ${input.account_id} not found`);

  // A locked account only accepts being unlocked; every other change waits.
  if (row.is_locked && input.patch.is_locked !== false) {
    throw new PreconditionError('Account is locked — unlock it before making changes', { code: row.code });
  }

  // System accounts are found by system_key, so their number, name and parent are
  // free to change. What they are (type, detail type) and being active are not.
  if (row.is_system) {
    if (input.patch.account_type !== undefined && input.patch.account_type !== row.account_type) {
      throw new PreconditionError(`${row.name} is a system account; its account type cannot change`, { code: row.code });
    }
    if (input.patch.detail_type !== undefined && (input.patch.detail_type ?? null) !== (row.detail_type ?? null)) {
      throw new PreconditionError(`${row.name} is a system account; its detail type cannot change`, { code: row.code });
    }
    if (input.patch.is_active === false) {
      throw new PreconditionError(`System account ${row.code} — ${row.name} cannot be deactivated`, { code: row.code });
    }
  }

  if (input.patch.parent_id === input.account_id) {
    throw new PreconditionError('parent_id cannot equal account id (self-reference)');
  }

  const newType = input.patch.account_type ?? row.account_type;
  const typeChanges = newType !== row.account_type;
  if (typeChanges) {
    const child = await trx.selectFrom('chart_of_accounts').select('code')
      .where('parent_id', '=', row.id).executeTakeFirst();
    if (child) {
      throw new PreconditionError(`Move this account's subaccounts first (${child.code}); a parent and its subaccounts share one type`, { code: row.code });
    }
    const bank = await trx.selectFrom('bank_accounts').select('id')
      .where('cash_account_id', '=', row.id).executeTakeFirst();
    if (bank && newType !== 'asset' && newType !== 'liability') {
      throw new PreconditionError('This account is linked to a bank or card account, so it must stay an asset or a liability', { code: row.code });
    }
  }
  const parentId = input.patch.parent_id !== undefined ? input.patch.parent_id : row.parent_id;
  if (parentId && (typeChanges || input.patch.parent_id !== undefined)) {
    const parent = await trx.selectFrom('chart_of_accounts').select(['account_type', 'name'])
      .where('id', '=', parentId).where('business_id', '=', row.business_id).executeTakeFirst();
    if (!parent) throw new BusinessRuleError(ERR.NOT_FOUND, 'Parent account not found');
    if (parent.account_type !== newType) {
      throw new PreconditionError(`A subaccount must be the same type as its parent (${parent.name} is ${parent.account_type})`, { code: row.code });
    }
  }

  if (input.patch.code !== undefined && input.patch.code !== row.code) {
    const dup = await trx.selectFrom('chart_of_accounts')
      .select('id')
      .where('business_id', '=', row.business_id)
      .where('code', '=', input.patch.code)
      .where('id', '!=', input.account_id)
      .executeTakeFirst();
    if (dup) throw new BusinessRuleError(ERR.DUPLICATE_RESOURCE, `Account code ${input.patch.code} already exists`);
  }

  const updated = await trx.updateTable('chart_of_accounts')
    .set({
      ...(input.patch.code !== undefined ? { code: input.patch.code } : {}),
      ...(input.patch.name !== undefined ? { name: input.patch.name } : {}),
      ...(typeChanges ? { account_type: newType } : {}),
      ...(input.patch.parent_id !== undefined ? { parent_id: input.patch.parent_id } : {}),
      ...(input.patch.is_active !== undefined ? { is_active: input.patch.is_active } : {}),
      // A detail type belongs to its account type: a type change without one clears it.
      ...(input.patch.detail_type !== undefined
        ? { detail_type: input.patch.detail_type }
        : typeChanges ? { detail_type: null } : {}),
      ...(input.patch.description !== undefined ? { description: input.patch.description } : {}),
      ...(input.patch.is_locked !== undefined ? { is_locked: input.patch.is_locked } : {}),
    })
    .where('id', '=', input.account_id)
    .returningAll()
    .executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: input.patch.is_active === false ? AUDIT.COA_DEACTIVATE : AUDIT.COA_UPDATE,
    entity_type: 'chart_of_account',
    entity_id: input.account_id,
    before: row,
    after: updated,
  });
  return updated;
}

/** This client's Suspense account, by its system key (its name and number can be changed per client). */
export async function findSuspenseAccount(db: Kysely<DB> | Transaction<DB>, business_id: string) {
  return db.selectFrom('chart_of_accounts').selectAll()
    .where('business_id', '=', business_id)
    .where(eb => eb.or([
      eb('system_key', '=', 'suspense'),
      eb.and([eb('system_key', 'is', null), eb('detail_type', '=', SUSPENSE_DETAIL_TYPE)]),
    ]))
    .orderBy('created_at')
    .executeTakeFirst();
}

/**
 * Where the AI parks what it cannot code. Every business gets one (migration
 * 0082 and seedDefaultCoa); this also covers a business created some other way.
 * 1999, or the first free 199x code.
 */
export async function getOrCreateSuspenseAccount(trx: Transaction<DB>, ctx: ServiceCtx, business_id: string) {
  const existing = await findSuspenseAccount(trx, business_id);
  if (existing) return existing;
  const taken = new Set(
    (await trx.selectFrom('chart_of_accounts').select('code')
      .where('business_id', '=', business_id)
      .where('code', 'like', '199%')
      .execute()).map(r => r.code),
  );
  const code = ['1999', '1998', '1997', '1996', '1995', '1994', '1993', '1992', '1991', '1990'].find(c => !taken.has(c));
  if (!code) throw new PreconditionError('No free 199x code for the Suspense account');
  const row = await trx.insertInto('chart_of_accounts').values({
    business_id, code, name: 'Suspense', account_type: 'asset', parent_id: null,
    detail_type: SUSPENSE_DETAIL_TYPE, is_system: true,
    description: 'Transactions waiting to be categorized. Should be zero before a period is closed.',
  }).returningAll().executeTakeFirstOrThrow();
  await auditRecord(trx, ctx, {
    action: AUDIT.COA_CREATE, entity_type: 'chart_of_account', entity_id: row.id, before: null, after: row,
  });
  return row;
}

export async function seedDefaultCoa(trx: Transaction<DB>, ctx: ServiceCtx, input: { business_id: string }) {
  await sql`SELECT seed_default_coa(${input.business_id}::uuid)`.execute(trx);
  await trx.insertInto('chart_of_accounts').values({
    business_id: input.business_id, code: '1999', name: 'Suspense', account_type: 'asset', parent_id: null,
    detail_type: SUSPENSE_DETAIL_TYPE, is_system: true,
    description: 'Transactions waiting to be categorized. Should be zero before a period is closed.',
  }).onConflict(oc => oc.columns(['business_id', 'code']).doNothing()).execute();
  const inserted = await trx.selectFrom('chart_of_accounts').selectAll()
    .where('business_id', '=', input.business_id).execute();
  for (const row of inserted) {
    await auditRecord(trx, ctx, {
      action: AUDIT.COA_CREATE,
      entity_type: 'chart_of_account',
      entity_id: row.id,
      before: null,
      after: row,
    });
  }
}

export async function listAccounts(db: Kysely<DB>, q: { business_id: string; include_inactive?: boolean }) {
  let query = db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', q.business_id);
  if (!q.include_inactive) query = query.where('is_active', '=', true);
  return query.orderBy('code', 'asc').execute();
}

export type AccountRegisterRow = {
  journal_entry_id: string;
  line_id: string;
  entry_date: string;
  reference: string | null;
  source_type: string;
  memo: string | null;
  debit: string;
  credit: string;
  balance: string; // running balance in the account's natural sign, ascending by date
  is_voided: boolean;
  counter_account: string; // name of the other side of the entry ("—" for multi-line splits resolved to first)
};

// QBO-style account register: every ledger line hitting the account, oldest
// first, with a running balance. Natural sign: debit-normal for asset/expense,
// credit-normal for liability/equity/revenue. Voided entries appear together
// with their posted reversals (they net to zero) so history stays visible.
export async function listAccountRegister(
  db: Kysely<DB>, q: { business_id: string; account_id: string },
) {
  const account = await db.selectFrom('chart_of_accounts').selectAll()
    .where('id', '=', q.account_id)
    .where('business_id', '=', q.business_id)
    .executeTakeFirst();
  if (!account) throw new BusinessRuleError(ERR.NOT_FOUND, `Account ${q.account_id} not found`);

  const lines = await db.selectFrom('journal_entry_lines as jel')
    .innerJoin('journal_entries as je', 'je.id', 'jel.journal_entry_id')
    .select([
      'je.id as journal_entry_id', 'jel.id as line_id',
      'je.entry_date', 'je.reference', 'je.source_type', 'je.status',
      'jel.memo as line_memo', 'je.memo as je_memo',
      'jel.debit', 'jel.credit',
    ])
    .where('jel.account_id', '=', q.account_id)
    .where('je.status', 'in', ['posted', 'voided'])
    .orderBy('je.entry_date', 'asc')
    .orderBy('je.created_at', 'asc')
    .orderBy('jel.line_number', 'asc')
    .execute();

  // The "other side" of each entry, QBO's Payee/Account column. First counter
  // line wins for multi-line splits.
  const jeIds = [...new Set(lines.map(l => l.journal_entry_id))];
  const counterLines = jeIds.length > 0
    ? await db.selectFrom('journal_entry_lines as jel')
        .innerJoin('chart_of_accounts as ca', 'ca.id', 'jel.account_id')
        .select(['jel.journal_entry_id', 'ca.name as account_name'])
        .where('jel.journal_entry_id', 'in', jeIds)
        .where('jel.account_id', '!=', q.account_id)
        .orderBy('jel.line_number', 'asc')
        .execute()
    : [];
  const counterMap = new Map<string, string>();
  for (const cl of counterLines) {
    if (!counterMap.has(cl.journal_entry_id)) counterMap.set(cl.journal_entry_id, cl.account_name);
  }

  const debitNormal = account.account_type === 'asset' || account.account_type === 'expense';
  let running = '0.0000';
  const rows: AccountRegisterRow[] = lines.map(l => {
    const signed = debitNormal ? subMoney(l.debit, l.credit) : subMoney(l.credit, l.debit);
    running = toMoneyString(addMoney(running, signed));
    return {
      journal_entry_id: l.journal_entry_id,
      line_id: l.line_id,
      entry_date: l.entry_date,
      reference: l.reference,
      source_type: l.source_type,
      memo: l.line_memo ?? l.je_memo,
      debit: toMoneyString(l.debit),
      credit: toMoneyString(l.credit),
      balance: running,
      is_voided: l.status === 'voided',
      counter_account: counterMap.get(l.journal_entry_id) ?? '—',
    };
  });

  return { account, rows, ending_balance: running };
}

/** The system accounts the app posts to on its own (migration 0083 keys them). */
export type SystemAccountKey =
  | 'cash_on_hand' | 'operating_bank' | 'accounts_receivable' | 'accounts_payable'
  | 'sales_tax_payable' | 'retained_earnings' | 'suspense';

/** Found by key, not number: an accountant can renumber Accounts Payable without breaking bills. */
export async function getSystemAccount(db: Kysely<DB>, business_id: string, key: SystemAccountKey) {
  const row = await db.selectFrom('chart_of_accounts')
    .selectAll()
    .where('business_id', '=', business_id)
    .where('system_key', '=', key)
    .executeTakeFirst();
  if (!row) throw new BusinessRuleError(ERR.NOT_FOUND, `System account ${key} not found for business ${business_id}`);
  if (!row.is_active) throw new BusinessRuleError(ERR.PRECONDITION_FAILED, `Account ${row.code} — ${row.name} is inactive. Reactivate it from Chart of Accounts before posting.`);
  return row;
}
