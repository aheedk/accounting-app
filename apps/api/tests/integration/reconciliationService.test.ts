import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import {
  makeFirm, makeBusiness, makeUser, seedCoa, seedYearPeriods, makeBankAccount,
} from '../helpers/factories.js';
import * as btSvc from '../../src/services/banking/bankTransactionService.js';
import * as reconSvc from '../../src/services/banking/reconciliationService.js';
import { postJournalEntry } from '../../src/services/core/ledgerService.js';
import { ERR } from '@accounting/shared';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-0000000bbb50', ip_address: '127.0.0.1', user_agent: 'vitest' };

async function setup(t: TestDb) {
  const firm = await makeFirm(t.db);
  const biz = await makeBusiness(t.db, firm.id);
  const user = await makeUser(t.db, firm.id, { role: 'accountant' });
  const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
  await seedCoa(t.db, biz.id);
  await seedYearPeriods(t.db, biz.id, 2026);
  const cash = await t.db.selectFrom('chart_of_accounts').selectAll()
    .where('business_id', '=', biz.id).where('code', '=', '1020').executeTakeFirstOrThrow();
  const revenue = await t.db.selectFrom('chart_of_accounts').selectAll()
    .where('business_id', '=', biz.id).where('code', '=', '4010').executeTakeFirstOrThrow();
  const bankAccount = await makeBankAccount(t.db, biz.id, cash.id, { name: 'Primary' });
  return { firm, biz, user, ctx, cash, revenue, bankAccount };
}

describe('reconciliationService', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('createReconciliation marks all reviewed, unreconciled bank_transactions in the period as is_reconciled=true and sets their reconciliation_id', async () => {
    const { biz, ctx, bankAccount, cash, revenue } = await setup(t);

    // Import 3 bank transactions in the period
    await t.db.transaction().execute(trx =>
      btSvc.importTransactions(trx, ctx, {
        business_id: biz.id,
        bank_account_id: bankAccount.id,
        rows: [
          { transaction_date: '2026-04-05', description: 'Consulting fee',    amount: '500.0000', external_id: 'r-1' },
          { transaction_date: '2026-04-15', description: 'Invoice receipt',   amount: '300.0000', external_id: 'r-2' },
          { transaction_date: '2026-04-20', description: 'Transfer to other', amount: '-75.0000', external_id: 'r-3' },
        ],
      }),
    );
    const txns = await t.db.selectFrom('bank_transactions').selectAll()
      .where('bank_account_id', '=', bankAccount.id).orderBy('external_id').execute();
    expect(txns).toHaveLength(3);

    // Review all 3: categorize 1, match 1, exclude 1
    const matchJe = await t.db.transaction().execute(trx =>
      postJournalEntry(trx, ctx, {
        business_id: biz.id,
        entry_date: '2026-04-15',
        source_type: 'manual',
        memo: 'Existing JE for invoice',
        lines: [
          { account_id: cash.id,    debit: '300.0000', credit: '0.0000', memo: null },
          { account_id: revenue.id, debit: '0.0000',   credit: '300.0000', memo: null },
        ],
      }),
    );

    await t.db.transaction().execute(trx =>
      btSvc.categorize(trx, ctx, {
        bank_transaction_id: txns[0]!.id,
        offset_account_id: revenue.id,
        memo: null,
      }),
    );
    await t.db.transaction().execute(trx =>
      btSvc.match(trx, ctx, { bank_transaction_id: txns[1]!.id, journal_entry_id: matchJe.id }),
    );
    await t.db.transaction().execute(trx =>
      btSvc.exclude(trx, ctx, { bank_transaction_id: txns[2]!.id, excluded_reason: 'Own-account transfer' }),
    );

    // Create reconciliation
    const recon = await t.db.transaction().execute(trx =>
      reconSvc.createReconciliation(trx, ctx, {
        business_id: biz.id,
        bank_account_id: bankAccount.id,
        period_start: '2026-04-01',
        period_end: '2026-04-30',
        statement_ending_balance: '725.0000',
        memo: 'April close',
      }),
    );
    expect(recon.id).toBeTruthy();
    expect(recon.statement_ending_balance).toBe('725.0000');

    // All 3 should now be is_reconciled=true and linked to the recon.id
    const after = await t.db.selectFrom('bank_transactions').selectAll()
      .where('bank_account_id', '=', bankAccount.id).orderBy('external_id').execute();
    for (const row of after) {
      expect(row.is_reconciled).toBe(true);
      expect(row.reconciliation_id).toBe(recon.id);
    }

    const audit = await t.db.selectFrom('audit_logs').selectAll()
      .where('action', '=', 'reconciliation.create').execute();
    expect(audit).toHaveLength(1);
  });

  it('createReconciliation rejects when unreviewed rows remain in the period', async () => {
    const { biz, ctx, bankAccount, cash, revenue } = await setup(t);

    // Import 3 bank transactions
    await t.db.transaction().execute(trx =>
      btSvc.importTransactions(trx, ctx, {
        business_id: biz.id,
        bank_account_id: bankAccount.id,
        rows: [
          { transaction_date: '2026-04-05', description: 'A', amount: '500.0000', external_id: 'u-1' },
          { transaction_date: '2026-04-15', description: 'B', amount: '300.0000', external_id: 'u-2' },
          { transaction_date: '2026-04-20', description: 'C', amount: '-75.0000', external_id: 'u-3' },
        ],
      }),
    );
    const txns = await t.db.selectFrom('bank_transactions').selectAll()
      .where('bank_account_id', '=', bankAccount.id).orderBy('external_id').execute();

    // Review only 2 of 3: categorize + match
    const je = await t.db.transaction().execute(trx =>
      postJournalEntry(trx, ctx, {
        business_id: biz.id,
        entry_date: '2026-04-15',
        source_type: 'manual',
        memo: 'JE',
        lines: [
          { account_id: cash.id,    debit: '300.0000', credit: '0.0000', memo: null },
          { account_id: revenue.id, debit: '0.0000',   credit: '300.0000', memo: null },
        ],
      }),
    );
    await t.db.transaction().execute(trx =>
      btSvc.categorize(trx, ctx, {
        bank_transaction_id: txns[0]!.id,
        offset_account_id: revenue.id,
        memo: null,
      }),
    );
    await t.db.transaction().execute(trx =>
      btSvc.match(trx, ctx, { bank_transaction_id: txns[1]!.id, journal_entry_id: je.id }),
    );

    // 1 row remains unreviewed → reconcile should fail
    await expect(
      t.db.transaction().execute(trx =>
        reconSvc.createReconciliation(trx, ctx, {
          business_id: biz.id,
          bank_account_id: bankAccount.id,
          period_start: '2026-04-01',
          period_end: '2026-04-30',
          statement_ending_balance: '725.0000',
          memo: null,
        }),
      ),
    ).rejects.toMatchObject({ code: ERR.PRECONDITION_FAILED });

    // Now exclude the 3rd → reconcile should succeed
    await t.db.transaction().execute(trx =>
      btSvc.exclude(trx, ctx, { bank_transaction_id: txns[2]!.id, excluded_reason: 'Own-account transfer' }),
    );
    const recon = await t.db.transaction().execute(trx =>
      reconSvc.createReconciliation(trx, ctx, {
        business_id: biz.id,
        bank_account_id: bankAccount.id,
        period_start: '2026-04-01',
        period_end: '2026-04-30',
        statement_ending_balance: '725.0000',
        memo: null,
      }),
    );
    expect(recon.id).toBeTruthy();

    const after = await t.db.selectFrom('bank_transactions').selectAll()
      .where('bank_account_id', '=', bankAccount.id).execute();
    for (const row of after) {
      expect(row.is_reconciled).toBe(true);
      expect(row.reconciliation_id).toBe(recon.id);
    }
  });
});
