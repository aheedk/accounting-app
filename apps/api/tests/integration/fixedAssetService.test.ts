import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import {
  makeFirm, makeBusiness, makeUser, seedCoa, seedYearPeriods, makeFixedAsset,
} from '../helpers/factories.js';
import * as fixedAssetSvc from '../../src/services/assets/fixedAssetService.js';
import { postJournalEntry } from '../../src/services/core/ledgerService.js';
import { ERR } from '@accounting/shared';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-0000000bbb60', ip_address: '127.0.0.1', user_agent: 'vitest' };

async function setup(t: TestDb) {
  const firm = await makeFirm(t.db);
  const biz = await makeBusiness(t.db, firm.id);
  const user = await makeUser(t.db, firm.id, { role: 'accountant' });
  const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
  await seedCoa(t.db, biz.id);
  await seedYearPeriods(t.db, biz.id, 2026);

  // 1500 Equipment (asset), 1510 Accumulated Depreciation (asset),
  // 5910 Depreciation Expense (expense), 4010 Sales Revenue (revenue).
  const equipment = await t.db.selectFrom('chart_of_accounts').selectAll()
    .where('business_id', '=', biz.id).where('code', '=', '1500').executeTakeFirstOrThrow();
  const accumDep = await t.db.selectFrom('chart_of_accounts').selectAll()
    .where('business_id', '=', biz.id).where('code', '=', '1510').executeTakeFirstOrThrow();
  const depExpense = await t.db.selectFrom('chart_of_accounts').selectAll()
    .where('business_id', '=', biz.id).where('code', '=', '5910').executeTakeFirstOrThrow();
  const revenue = await t.db.selectFrom('chart_of_accounts').selectAll()
    .where('business_id', '=', biz.id).where('code', '=', '4010').executeTakeFirstOrThrow();
  const cash = await t.db.selectFrom('chart_of_accounts').selectAll()
    .where('business_id', '=', biz.id).where('code', '=', '1020').executeTakeFirstOrThrow();
  return { firm, biz, user, ctx, equipment, accumDep, depExpense, revenue, cash };
}

describe('fixedAssetService', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('createFixedAsset validates account types and inserts', async () => {
    const { biz, ctx, equipment, accumDep, depExpense, revenue } = await setup(t);

    // Wrong-type dep_expense_account_id (revenue instead of expense) → PreconditionError.
    await expect(
      t.db.transaction().execute(trx =>
        fixedAssetSvc.createFixedAsset(trx, ctx, {
          business_id: biz.id,
          name: 'Laptop',
          asset_account_id: equipment.id,
          depreciation_expense_account_id: revenue.id, // wrong type
          accumulated_depreciation_account_id: accumDep.id,
          purchase_date: '2026-01-01',
          cost: '2400.0000',
          salvage_value: '0.0000',
          useful_life_years: 2,
          memo: null,
        }),
      ),
    ).rejects.toMatchObject({ code: ERR.PRECONDITION_FAILED });

    // Correct types → succeeds.
    const row = await t.db.transaction().execute(trx =>
      fixedAssetSvc.createFixedAsset(trx, ctx, {
        business_id: biz.id,
        name: 'Laptop',
        asset_account_id: equipment.id,
        depreciation_expense_account_id: depExpense.id,
        accumulated_depreciation_account_id: accumDep.id,
        purchase_date: '2026-01-01',
        cost: '2400.0000',
        salvage_value: '0.0000',
        useful_life_years: 2,
        memo: null,
      }),
    );
    expect(row.name).toBe('Laptop');
    expect(row.cost).toBe('2400.0000');
    expect(row.salvage_value).toBe('0.0000');
    expect(row.useful_life_years).toBe(2);
    expect(row.status).toBe('active');
    expect(row.depreciation_method).toBe('straight_line');

    const audit = await t.db.selectFrom('audit_logs').selectAll()
      .where('action', '=', 'fixed_asset.create').execute();
    expect(audit).toHaveLength(1);
  });

  it('listFixedAssets computes accumulated_depreciation from depreciation_entries', async () => {
    const { biz, ctx, equipment, accumDep, depExpense, revenue, cash } = await setup(t);

    const asset = await makeFixedAsset(t.db, biz.id, {
      asset: equipment.id, dep_expense: depExpense.id, accumulated: accumDep.id,
    }, { cost: '2400.0000', salvage_value: '0.0000', useful_life_years: 2 });

    // Create a minimal manual JE that we can reference from depreciation_entries
    // (JE id is required FK; in real code depreciation posts its own JE, but for
    // list-aggregation testing any posted JE will do).
    const je = await t.db.transaction().execute(trx =>
      postJournalEntry(trx, ctx, {
        business_id: biz.id,
        entry_date: '2026-01-31',
        source_type: 'manual',
        memo: 'Test JE',
        lines: [
          { account_id: cash.id,    debit: '300.0000', credit: '0.0000', memo: null },
          { account_id: revenue.id, debit: '0.0000',   credit: '300.0000', memo: null },
        ],
      }),
    );

    // Insert 3 depreciation_entries rows ($100 each) linked to the JE above.
    await t.db.insertInto('depreciation_entries').values([
      { fixed_asset_id: asset.id, period_end: '2026-01-31', amount: '100.0000', journal_entry_id: je.id },
      { fixed_asset_id: asset.id, period_end: '2026-02-28', amount: '100.0000', journal_entry_id: je.id },
      { fixed_asset_id: asset.id, period_end: '2026-03-31', amount: '100.0000', journal_entry_id: je.id },
    ]).execute();

    const list = await fixedAssetSvc.listFixedAssets(t.db, biz.id);
    expect(list).toHaveLength(1);
    expect(list[0]?.accumulated_depreciation).toBe('300.0000');
    expect(list[0]?.book_value).toBe('2100.0000');
    expect(list[0]?.cost).toBe('2400.0000');

    const one = await fixedAssetSvc.getFixedAsset(t.db, biz.id, asset.id);
    expect(one.accumulated_depreciation).toBe('300.0000');
    expect(one.book_value).toBe('2100.0000');
  });
});
