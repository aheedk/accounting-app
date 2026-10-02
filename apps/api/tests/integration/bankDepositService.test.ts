import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'kysely';
import { startTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, grantAccess, makeAccount, makeBankAccount, makeCustomer, seedCoa, seedYearPeriods } from '../helpers/factories.js';
import { systemCtx } from '../../src/lib/ctx.js';
import * as depositSvc from '../../src/services/banking/bankDepositService.js';
import * as paymentSvc from '../../src/services/ar/paymentService.js';

let t: TestDb;
beforeAll(async () => { t = await startTestDb(); });
beforeEach(async () => { await truncateAll(t.db); });

async function bootstrap() {
  const firm = await makeFirm(t.db);
  const biz = await makeBusiness(t.db, firm.id);
  const user = await makeUser(t.db, firm.id);
  await grantAccess(t.db, user.id, biz.id);
  await seedCoa(t.db, biz.id);
  const currentYear = new Date().getUTCFullYear();
  await seedYearPeriods(t.db, biz.id, currentYear);
  const ctx = systemCtx({ firm_id: firm.id, business_id: biz.id, user_id: user.id });

  const checking = await makeAccount(t.db, biz.id, { name: 'Test Checking', account_type: 'asset' });
  const bankAccount = await makeBankAccount(t.db, biz.id, checking.id, { name: 'Checking' });
  const undepositedFunds = await makeAccount(t.db, biz.id, { name: 'Test Undeposited Funds', account_type: 'asset' });
  const income = await makeAccount(t.db, biz.id, { name: 'Test Sales Revenue', account_type: 'revenue' });

  return { biz, user, ctx, bankAccount, checking, undepositedFunds, income };
}

async function makePostedPayment(ctx: ReturnType<typeof systemCtx>, bizId: string, undepositedFunds: { id: string }, amount = '500.00') {
  const customer = await makeCustomer(t.db, bizId);
  const { payment } = await t.db.transaction().execute(trx =>
    paymentSvc.createDraft(trx, ctx, {
      business_id: bizId,
      customer_id: customer.id,
      payment_date: '2026-03-01',
      payment_method: 'check',
      reference: 'CHK-1',
      amount,
      cash_account_id: undepositedFunds.id,
      memo: null,
    }),
  );
  await t.db.transaction().execute(trx => paymentSvc.postPayment(trx, ctx, { payment_id: payment.id }));
  return payment;
}

describe('bankDepositService', () => {
  it('createDeposit with only an "other funds" line posts a balanced JE and sets the total', async () => {
    const { biz, ctx, bankAccount, income } = await bootstrap();
    const deposit = await t.db.transaction().execute(trx => depositSvc.createDeposit(trx, ctx, {
      bank_account_id: bankAccount.id,
      deposit_date: '2026-03-02',
      memo: 'Cash sale',
      lines: [{ line_type: 'other_funds', account_id: income.id, description: 'Cash sale', amount: '250.00' }],
    }));

    expect(deposit.total_amount).toBe('250.00');
    expect(deposit.journal_entry_id).toBeTruthy();

    const jeLines = await t.db.selectFrom('journal_entry_lines')
      .selectAll().where('journal_entry_id', '=', deposit.journal_entry_id!).execute();
    expect(jeLines).toHaveLength(2);

    const audit = await t.db.selectFrom('audit_logs').selectAll()
      .where('business_id', '=', biz.id).where('action', '=', 'bank_deposit.create').execute();
    expect(audit).toHaveLength(1);
  });

  it('createDeposit with an undeposited-funds line marks the payment as deposited', async () => {
    const { biz, ctx, bankAccount, undepositedFunds } = await bootstrap();
    const payment = await makePostedPayment(ctx, biz.id, undepositedFunds);

    const deposit = await t.db.transaction().execute(trx => depositSvc.createDeposit(trx, ctx, {
      bank_account_id: bankAccount.id,
      deposit_date: '2026-03-03',
      lines: [{
        line_type: 'undeposited_funds', payment_id: payment.id,
        account_id: undepositedFunds.id, amount: payment.amount,
      }],
    }));
    expect(deposit.total_amount).toBe('500.00');

    const reloaded = await t.db.selectFrom('payments').select('is_deposited').where('id', '=', payment.id).executeTakeFirstOrThrow();
    expect(reloaded.is_deposited).toBe(true);
  });

  it('rejects a line posting to the same account as the deposit-to bank account', async () => {
    const { ctx, bankAccount, checking } = await bootstrap();
    await expect(t.db.transaction().execute(trx => depositSvc.createDeposit(trx, ctx, {
      bank_account_id: bankAccount.id,
      deposit_date: '2026-03-02',
      lines: [{ line_type: 'other_funds', account_id: checking.id, amount: '100.00' }],
    }))).rejects.toThrow(/cannot use the same account/);
  });

  it('rejects cash back greater than the lines total', async () => {
    const { ctx, bankAccount, income } = await bootstrap();
    await expect(t.db.transaction().execute(trx => depositSvc.createDeposit(trx, ctx, {
      bank_account_id: bankAccount.id,
      deposit_date: '2026-03-02',
      lines: [{ line_type: 'other_funds', account_id: income.id, amount: '100.00' }],
      cash_back_account_id: income.id,
      cash_back_amount: '150.00',
    }))).rejects.toThrow(/Cash back cannot exceed/);
  });

  it('rejects a deposit whose net total is zero', async () => {
    const { ctx, bankAccount, income } = await bootstrap();
    await expect(t.db.transaction().execute(trx => depositSvc.createDeposit(trx, ctx, {
      bank_account_id: bankAccount.id,
      deposit_date: '2026-03-02',
      lines: [{ line_type: 'other_funds', account_id: income.id, amount: '100.00' }],
      cash_back_account_id: income.id,
      cash_back_amount: '100.00',
    }))).rejects.toThrow(/greater than zero/);
  });

  it('updateDeposit replaces other-funds lines and reposts the JE, keeping undeposited lines fixed', async () => {
    const { biz, ctx, bankAccount, undepositedFunds, income } = await bootstrap();
    const payment = await makePostedPayment(ctx, biz.id, undepositedFunds, '500.00');

    const created = await t.db.transaction().execute(trx => depositSvc.createDeposit(trx, ctx, {
      bank_account_id: bankAccount.id,
      deposit_date: '2026-03-04',
      lines: [
        { line_type: 'undeposited_funds', payment_id: payment.id, account_id: undepositedFunds.id, amount: payment.amount },
        { line_type: 'other_funds', account_id: income.id, description: 'Interest', amount: '50.00' },
      ],
    }));
    expect(created.total_amount).toBe('550.00');
    const originalJeId = created.journal_entry_id!;

    const updated = await t.db.transaction().execute(trx => depositSvc.updateDeposit(trx, ctx, created.id, {
      bank_account_id: bankAccount.id,
      deposit_date: '2026-03-05',
      memo: 'Edited',
      lines: [{ line_type: 'other_funds', account_id: income.id, description: 'Interest (corrected)', amount: '75.00' }],
    }));

    expect(updated.total_amount).toBe('575.00');
    expect(updated.journal_entry_id).not.toBe(originalJeId);

    const originalJe = await t.db.selectFrom('journal_entries').select('status').where('id', '=', originalJeId).executeTakeFirstOrThrow();
    expect(originalJe.status).toBe('voided');

    const full = await depositSvc.getDeposit(t.db, ctx, created.id);
    expect(full.lines.filter(l => l.line_type === 'undeposited_funds')).toHaveLength(1);
    expect(full.lines.filter(l => l.line_type === 'other_funds')).toHaveLength(1);
    expect(full.lines.find(l => l.line_type === 'other_funds')?.amount).toBe('75.00');

    // The payment is still marked deposited — the undeposited line survived the edit untouched.
    const reloaded = await t.db.selectFrom('payments').select('is_deposited').where('id', '=', payment.id).executeTakeFirstOrThrow();
    expect(reloaded.is_deposited).toBe(true);
  });

  it('deleteDeposit voids the JE and un-marks any included payments', async () => {
    const { biz, ctx, bankAccount, undepositedFunds } = await bootstrap();
    const payment = await makePostedPayment(ctx, biz.id, undepositedFunds);
    const deposit = await t.db.transaction().execute(trx => depositSvc.createDeposit(trx, ctx, {
      bank_account_id: bankAccount.id,
      deposit_date: '2026-03-06',
      lines: [{ line_type: 'undeposited_funds', payment_id: payment.id, account_id: undepositedFunds.id, amount: payment.amount }],
    }));

    await t.db.transaction().execute(trx => depositSvc.deleteDeposit(trx, ctx, deposit.id));

    const je = await t.db.selectFrom('journal_entries').select('status').where('id', '=', deposit.journal_entry_id!).executeTakeFirstOrThrow();
    expect(je.status).toBe('voided');
    const reloaded = await t.db.selectFrom('payments').select('is_deposited').where('id', '=', payment.id).executeTakeFirstOrThrow();
    expect(reloaded.is_deposited).toBe(false);
    await expect(depositSvc.getDeposit(t.db, ctx, deposit.id)).rejects.toThrow();
  });

  it('a normally created deposit is editable', async () => {
    const { ctx, bankAccount, income } = await bootstrap();
    const deposit = await t.db.transaction().execute(trx => depositSvc.createDeposit(trx, ctx, {
      bank_account_id: bankAccount.id,
      deposit_date: '2026-03-02',
      lines: [{ line_type: 'other_funds', account_id: income.id, amount: '100.00' }],
    }));
    const full = await depositSvc.getDeposit(t.db, ctx, deposit.id);
    expect(full.editable).toBe(true);
  });

  it('wrapImportedDepositJournalEntry produces a deposit that is still fully editable and deletable', async () => {
    const { biz, ctx, bankAccount, checking, income } = await bootstrap();

    const je = await t.db.transaction().execute(async trx => {
      const posted = await trx.insertInto('journal_entries').values({
        business_id: biz.id,
        period_id: (await trx.selectFrom('fiscal_periods').select('id').where('business_id', '=', biz.id).where('starts_on', '<=', '2026-03-07').where('ends_on', '>=', '2026-03-07').executeTakeFirstOrThrow()).id,
        entry_date: '2026-03-07',
        journal_number: 'IMPORT-1',
        memo: 'Imported deposit',
        status: 'draft',
        source_type: 'bank_import',
        // Real imports always set a staging-row source_id (see emailImports.ts);
        // only a non-null source_id lets voidGuardFor authorize the edit below.
        source_id: '00000000-0000-0000-0000-000000000001',
        transaction_type: 'deposit',
        created_by_user_id: ctx.user_id,
      }).returningAll().executeTakeFirstOrThrow();
      await trx.insertInto('journal_entry_lines').values([
        { journal_entry_id: posted.id, line_number: 1, account_id: checking.id, debit: '400.00', credit: '0', memo: null },
        { journal_entry_id: posted.id, line_number: 2, account_id: income.id, debit: '0', credit: '400.00', memo: null },
      ]).execute();
      return trx.updateTable('journal_entries').set({ status: 'posted', posted_at: sql`now()` }).where('id', '=', posted.id).returningAll().executeTakeFirstOrThrow();
    });

    const wrapped = await t.db.transaction().execute(trx => depositSvc.wrapImportedDepositJournalEntry(trx, ctx, {
      journal_entry_id: je.id,
      chart_account_id: checking.id,
      offset_account_id: income.id,
      entry_date: '2026-03-07',
      description: 'Imported deposit',
      amount: '400.00',
    }));
    expect(wrapped).not.toBeNull();

    // editable=false still marks its provenance (drives the "Imported" badge),
    // but — same as QuickBooks — it does not block editing or deleting.
    const full = await depositSvc.getDeposit(t.db, ctx, wrapped!.id);
    expect(full.editable).toBe(false);

    const updated = await t.db.transaction().execute(trx => depositSvc.updateDeposit(trx, ctx, wrapped!.id, {
      bank_account_id: bankAccount.id,
      deposit_date: '2026-03-07',
      lines: [{ line_type: 'other_funds', account_id: income.id, amount: '500.00' }],
    }));
    expect(updated.total_amount).toBe('500.00');

    await t.db.transaction().execute(trx => depositSvc.deleteDeposit(trx, ctx, wrapped!.id));
    await expect(depositSvc.getDeposit(t.db, ctx, wrapped!.id)).rejects.toThrow();
  });

  it('listUndepositedPayments only returns posted, non-deposited payments', async () => {
    const { biz, ctx, undepositedFunds } = await bootstrap();
    const included = await makePostedPayment(ctx, biz.id, undepositedFunds, '125.00');
    const draftCustomer = await makeCustomer(t.db, biz.id);
    await t.db.transaction().execute(trx => paymentSvc.createDraft(trx, ctx, {
      business_id: biz.id,
      customer_id: draftCustomer.id,
      payment_date: '2026-03-01',
      payment_method: 'check',
      reference: null,
      amount: '75.00',
      cash_account_id: undepositedFunds.id,
      memo: null,
    }));

    const list = await depositSvc.listUndepositedPayments(t.db, ctx);
    expect(list.map(p => p.id)).toEqual([included.id]);
  });
});
