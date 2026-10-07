import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { startTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import {
  makeFirm, makeBusiness, makeUser, grantAccess, makeAccount, makeBankAccount, makeVendor,
  seedCoa, seedYearPeriods,
} from '../helpers/factories.js';
import { systemCtx } from '../../src/lib/ctx.js';
import * as checkSvc from '../../src/services/ap/checkService.js';
import * as expenseSvc from '../../src/services/ap/expenseTransactionService.js';
import * as ledger from '../../src/services/core/ledgerService.js';

let t: TestDb;
beforeAll(async () => { t = await startTestDb(); });
beforeEach(async () => { await truncateAll(t.db); });

async function bootstrap() {
  const firm = await makeFirm(t.db);
  const biz = await makeBusiness(t.db, firm.id);
  const user = await makeUser(t.db, firm.id);
  await grantAccess(t.db, user.id, biz.id);
  await seedCoa(t.db, biz.id);
  await seedYearPeriods(t.db, biz.id, 2026);
  const repairs = await makeAccount(t.db, biz.id, { code: '7300', name: 'Repairs and Maintenance', account_type: 'expense' });
  const supplies = await makeAccount(t.db, biz.id, { code: '6000', name: 'Office Supplies', account_type: 'expense' });
  const cash = await makeAccount(t.db, biz.id, { code: '1120', name: 'Cash in Bank', account_type: 'asset' });
  const bankAccount = await makeBankAccount(t.db, biz.id, cash.id, { name: 'Operating Checking' });
  const ctx = systemCtx({ firm_id: firm.id, business_id: biz.id, user_id: user.id });
  return { firm, biz, user, ctx, repairs, supplies, cash, bankAccount };
}

describe('checkService', () => {
  it('createCheck posts a balanced JE (debit each line, credit the bank account) and sets the total', async () => {
    const { ctx, repairs, supplies, cash, bankAccount } = await bootstrap();
    const check = await t.db.transaction().execute(trx => checkSvc.createCheck(trx, ctx, {
      payment_date: '2026-04-15',
      payee_text: 'Action Lawn Maintenance',
      bank_account_id: bankAccount.id,
      memo: 'Mowing',
      lines: [
        { account_id: repairs.id, amount: '150.00', description: 'Mowing' },
        { account_id: supplies.id, amount: '20.00' },
      ],
    }));

    expect(check.status).toBe('posted');
    expect(check.total_amount).toBe('170.0000');
    expect(check.journal_entry_id).toBeTruthy();
    // Auto-assigned: no checks exist yet for this bank account.
    expect(check.check_number).toBe('1');

    const entry = await t.db.selectFrom('journal_entries').selectAll()
      .where('id', '=', check.journal_entry_id!).executeTakeFirstOrThrow();
    expect(entry.source_type).toBe('check');
    expect(entry.source_id).toBe(check.id);
    expect(entry.transaction_type).toBe('check');
    expect(entry.reference).toBe('1');

    const lines = await t.db.selectFrom('journal_entry_lines').selectAll()
      .where('journal_entry_id', '=', check.journal_entry_id!).execute();
    expect(lines).toHaveLength(3);
    const dr1 = lines.find(l => l.account_id === repairs.id);
    const dr2 = lines.find(l => l.account_id === supplies.id);
    const cr = lines.find(l => l.account_id === cash.id);
    expect(dr1?.debit).toBe('150.0000');
    expect(dr2?.debit).toBe('20.0000');
    expect(cr?.credit).toBe('170.0000');
    expect(cr?.debit).toBe('0.0000');
  });

  it('nextCheckNumber increments per bank account and skips non-numeric numbers', async () => {
    const { biz, ctx, repairs, bankAccount } = await bootstrap();
    const otherCash = await makeAccount(t.db, biz.id, { code: '1130', name: 'Savings', account_type: 'asset' });
    const otherBankAccount = await makeBankAccount(t.db, biz.id, otherCash.id, { name: 'Savings' });

    expect(await checkSvc.nextCheckNumber(t.db, biz.id, bankAccount.id)).toBe('1');

    await t.db.transaction().execute(trx => checkSvc.createCheck(trx, ctx, {
      payment_date: '2026-04-15', payee_text: 'Vendor A', check_number: '5548',
      bank_account_id: bankAccount.id, lines: [{ account_id: repairs.id, amount: '10.00' }],
    }));
    expect(await checkSvc.nextCheckNumber(t.db, biz.id, bankAccount.id)).toBe('5549');

    // A non-numeric check number (EFT-001) is skipped, not treated as the max.
    await t.db.transaction().execute(trx => checkSvc.createCheck(trx, ctx, {
      payment_date: '2026-04-16', payee_text: 'Vendor B', check_number: 'EFT-001',
      bank_account_id: bankAccount.id, lines: [{ account_id: repairs.id, amount: '10.00' }],
    }));
    expect(await checkSvc.nextCheckNumber(t.db, biz.id, bankAccount.id)).toBe('5549');

    // A different bank account keeps its own sequence, unaffected by the first.
    expect(await checkSvc.nextCheckNumber(t.db, biz.id, otherBankAccount.id)).toBe('1');
  });

  it('nextCheckNumber also counts checks written the old way, as an Expense with payment method Check', async () => {
    const { biz, ctx, cash, bankAccount } = await bootstrap();
    const misc = await makeAccount(t.db, biz.id, { code: '6500', name: 'Misc', account_type: 'expense' });
    await t.db.transaction().execute(trx => expenseSvc.createExpense(trx, ctx, {
      transaction_date: '2026-03-01', payee_text: 'Old Vendor', reference: '2399',
      payment_account_id: cash.id, payment_method: 'check',
      lines: [{ category_account_id: misc.id, amount: '50.00' }],
    }));

    // cash is this bank account's own cash account, so the legacy expense counts.
    expect(await checkSvc.nextCheckNumber(t.db, biz.id, bankAccount.id)).toBe('2400');

    // A legacy expense on an unrelated account (no matching bank_accounts row)
    // never joins to this bank account, so it can't skew its sequence.
    const otherCash = await makeAccount(t.db, biz.id, { code: '1170', name: 'Unlinked Cash', account_type: 'asset' });
    const misc2 = await makeAccount(t.db, biz.id, { code: '6510', name: 'Misc 2', account_type: 'expense' });
    await t.db.transaction().execute(trx => expenseSvc.createExpense(trx, ctx, {
      transaction_date: '2026-03-02', payee_text: 'Unrelated', reference: '999999',
      payment_account_id: otherCash.id, payment_method: 'check',
      lines: [{ category_account_id: misc2.id, amount: '20.00' }],
    }));
    expect(await checkSvc.nextCheckNumber(t.db, biz.id, bankAccount.id)).toBe('2400');
  });

  it('vendorDefaultCategory learns from the vendor\'s most recent check or expense', async () => {
    const { biz, ctx, repairs, supplies, cash, bankAccount } = await bootstrap();
    const vendor = await makeVendor(t.db, biz.id, { name: 'Action Lawn Maintenance' });

    expect(await checkSvc.vendorDefaultCategory(t.db, biz.id, vendor.id)).toBeNull();

    await t.db.transaction().execute(trx => checkSvc.createCheck(trx, ctx, {
      payment_date: '2026-04-01', payee_id: vendor.id, payee_type: 'vendor',
      bank_account_id: bankAccount.id, lines: [{ account_id: repairs.id, amount: '150.00' }],
    }));
    expect(await checkSvc.vendorDefaultCategory(t.db, biz.id, vendor.id)).toBe(repairs.id);

    // A more recent expense for the same vendor becomes the new default.
    await t.db.transaction().execute(trx => expenseSvc.createExpense(trx, ctx, {
      transaction_date: '2026-04-20', vendor_id: vendor.id,
      payment_account_id: cash.id, payment_method: 'cash',
      lines: [{ category_account_id: supplies.id, amount: '25.00' }],
    }));
    expect(await checkSvc.vendorDefaultCategory(t.db, biz.id, vendor.id)).toBe(supplies.id);
  });

  it('updateCheck voids the old JE on the original date and posts a replacement', async () => {
    const { ctx, repairs, supplies, cash, bankAccount } = await bootstrap();
    const check = await t.db.transaction().execute(trx => checkSvc.createCheck(trx, ctx, {
      payment_date: '2026-04-15', payee_text: 'Action Lawn Maintenance',
      bank_account_id: bankAccount.id, lines: [{ account_id: repairs.id, amount: '150.00' }],
    }));
    const firstJeId = check.journal_entry_id!;

    const updated = await t.db.transaction().execute(trx => checkSvc.updateCheck(trx, ctx, check.id, {
      payment_date: '2026-04-15', payee_text: 'Action Lawn Maintenance', check_number: check.check_number,
      bank_account_id: bankAccount.id, lines: [{ account_id: supplies.id, amount: '200.00' }],
    }));

    expect(updated.total_amount).toBe('200.0000');
    expect(updated.journal_entry_id).not.toBe(firstJeId);

    const oldJe = await t.db.selectFrom('journal_entries').selectAll().where('id', '=', firstJeId).executeTakeFirstOrThrow();
    expect(oldJe.status).toBe('voided');
    const reversal = await t.db.selectFrom('journal_entries').selectAll()
      .where('reversed_entry_id', '=', firstJeId).executeTakeFirstOrThrow();
    // Reversed on the check's own date, not today.
    expect(reversal.entry_date).toBe('2026-04-15');

    const cashBal = await ledger.computeAccountBalance(t.db, { account_id: cash.id, as_of: '2026-12-31' });
    expect(cashBal).toBe('-200.0000');
  });

  it('voidCheck reverses the JE dated the same day and marks the check void', async () => {
    const { ctx, repairs, bankAccount } = await bootstrap();
    const check = await t.db.transaction().execute(trx => checkSvc.createCheck(trx, ctx, {
      payment_date: '2026-04-15', payee_text: 'Action Lawn Maintenance',
      bank_account_id: bankAccount.id, lines: [{ account_id: repairs.id, amount: '150.00' }],
    }));

    const voided = await t.db.transaction().execute(trx => checkSvc.voidCheck(trx, ctx, { check_id: check.id }));
    expect(voided.status).toBe('void');
    expect(voided.voided_at).toBeTruthy();

    const reversal = await t.db.selectFrom('journal_entries').selectAll()
      .where('reversed_entry_id', '=', check.journal_entry_id!).executeTakeFirstOrThrow();
    expect(reversal.entry_date).toBe('2026-04-15');

    await expect(
      t.db.transaction().execute(trx => checkSvc.voidCheck(trx, ctx, { check_id: check.id })),
    ).rejects.toThrow(/already void/);
  });

  it('deleteCheck removes the check and hard-deletes the JE entirely', async () => {
    const { ctx, repairs, bankAccount } = await bootstrap();
    const check = await t.db.transaction().execute(trx => checkSvc.createCheck(trx, ctx, {
      payment_date: '2026-04-15', payee_text: 'Action Lawn Maintenance',
      bank_account_id: bankAccount.id, lines: [{ account_id: repairs.id, amount: '150.00' }],
    }));
    const jeId = check.journal_entry_id!;

    await t.db.transaction().execute(trx => checkSvc.deleteCheck(trx, ctx, check.id));

    const checkRow = await t.db.selectFrom('checks').select('id').where('id', '=', check.id).executeTakeFirst();
    expect(checkRow).toBeUndefined();
    const jeRow = await t.db.selectFrom('journal_entries').select('id').where('id', '=', jeId).executeTakeFirst();
    expect(jeRow).toBeUndefined();
  });

  it('getCheck and listChecks resolve the payee name and bank account label', async () => {
    const { biz, ctx, repairs, bankAccount } = await bootstrap();
    const vendor = await makeVendor(t.db, biz.id, { name: 'Action Lawn Maintenance' });
    const check = await t.db.transaction().execute(trx => checkSvc.createCheck(trx, ctx, {
      payment_date: '2026-04-15', payee_id: vendor.id, payee_type: 'vendor',
      bank_account_id: bankAccount.id, lines: [{ account_id: repairs.id, amount: '150.00', description: 'Mowing' }],
    }));

    const detail = await checkSvc.getCheck(t.db, ctx, check.id);
    expect(detail.payee_name).toBe('Action Lawn Maintenance');
    expect(detail.editable).toBe(true);
    expect(detail.is_reconciled).toBe(false);
    expect(detail.lines).toHaveLength(1);
    expect(detail.lines[0]?.account_name).toBe('Repairs and Maintenance');

    const list = await checkSvc.listChecks(t.db, ctx);
    expect(list).toHaveLength(1);
    expect(list[0]?.payee_name).toBe('Action Lawn Maintenance');
    expect(list[0]?.bank_account_name).toBe('Operating Checking');
    expect(list[0]?.legacy).toBe(false);
    expect(list[0]?.path).toBe(`/accounting/checks/${check.id}`);
  });

  it('listChecks also surfaces checks written the old way, as an Expense with payment method Check', async () => {
    const { ctx, repairs, cash, bankAccount } = await bootstrap();
    const legacy = await t.db.transaction().execute(trx => expenseSvc.createExpense(trx, ctx, {
      transaction_date: '2026-03-01', payee_text: 'Old Vendor', reference: '2399',
      payment_account_id: cash.id, payment_method: 'check',
      lines: [{ category_account_id: repairs.id, amount: '50.00' }],
    }));
    const real = await t.db.transaction().execute(trx => checkSvc.createCheck(trx, ctx, {
      payment_date: '2026-04-15', payee_text: 'New Vendor', bank_account_id: bankAccount.id,
      lines: [{ account_id: repairs.id, amount: '150.00' }],
    }));

    const list = await checkSvc.listChecks(t.db, ctx);
    expect(list).toHaveLength(2);
    // Most recent first.
    expect(list[0]?.id).toBe(real.id);
    expect(list[0]?.legacy).toBe(false);
    expect(list[1]?.id).toBe(legacy.id);
    expect(list[1]?.legacy).toBe(true);
    expect(list[1]?.check_number).toBe('2399');
    expect(list[1]?.path).toBe(`/accounting/expenses/${legacy.id}`);
    expect(list[1]?.bank_account_name).toBe('Operating Checking');
  });
});
