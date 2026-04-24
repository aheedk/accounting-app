import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, seedYearPeriods, seedCoa, makeFixedAsset } from '../helpers/factories.js';
import * as depreciation from '../../src/services/assets/depreciationService.js';
import { ERR } from '@accounting/shared';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-0000000fa007', ip_address: '127.0.0.1', user_agent: 'vitest' };

async function setup(t: TestDb) {
  const firm = await makeFirm(t.db);
  const biz = await makeBusiness(t.db, firm.id);
  const user = await makeUser(t.db, firm.id, { role: 'accountant' });
  const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
  await seedYearPeriods(t.db, biz.id, 2026);
  await seedCoa(t.db, biz.id);
  const equipment = await t.db.selectFrom('chart_of_accounts').selectAll()
    .where('business_id', '=', biz.id).where('code', '=', '1500').executeTakeFirstOrThrow();
  const accumDep = await t.db.selectFrom('chart_of_accounts').selectAll()
    .where('business_id', '=', biz.id).where('code', '=', '1510').executeTakeFirstOrThrow();
  const depExpense = await t.db.selectFrom('chart_of_accounts').selectAll()
    .where('business_id', '=', biz.id).where('code', '=', '5910').executeTakeFirstOrThrow();
  return { firm, biz, ctx, equipment, accumDep, depExpense };
}

describe('depreciationService', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('runDepreciation posts a JE and records the entry', async () => {
    const { biz, ctx, equipment, accumDep, depExpense } = await setup(t);
    const asset = await makeFixedAsset(t.db, biz.id, {
      asset: equipment.id, dep_expense: depExpense.id, accumulated: accumDep.id,
    }, { name: 'Laptop', cost: '2400.0000', salvage_value: '0', useful_life_years: 2 });

    const entry = await t.db.transaction().execute(trx =>
      depreciation.runDepreciation(trx, ctx, { fixed_asset_id: asset.id, period_end: '2026-01-31' }),
    );

    // Entry created with amount $100 (2400 / (2 * 12) = 100)
    expect(entry.fixed_asset_id).toBe(asset.id);
    expect(entry.period_end).toBe('2026-01-31');
    expect(entry.amount).toBe('100.0000');
    expect(entry.journal_entry_id).toBeTruthy();

    // JE has 2 lines: DR dep_expense 100, CR accumulated_dep 100
    const je = await t.db.selectFrom('journal_entries').selectAll()
      .where('id', '=', entry.journal_entry_id).executeTakeFirstOrThrow();
    expect(je.status).toBe('posted');
    expect(je.source_type).toBe('manual');
    expect(je.entry_date).toBe('2026-01-31');

    const lines = await t.db.selectFrom('journal_entry_lines').selectAll()
      .where('journal_entry_id', '=', entry.journal_entry_id).orderBy('line_number').execute();
    expect(lines).toHaveLength(2);
    const depExpLine = lines.find(l => l.account_id === depExpense.id);
    const accDepLine = lines.find(l => l.account_id === accumDep.id);
    expect(depExpLine).toBeDefined();
    expect(accDepLine).toBeDefined();
    expect(depExpLine!.debit).toBe('100.0000');
    expect(depExpLine!.credit).toBe('0.0000');
    expect(accDepLine!.credit).toBe('100.0000');
    expect(accDepLine!.debit).toBe('0.0000');

    // Audit row written
    const audit = await t.db.selectFrom('audit_logs').selectAll()
      .where('action', '=', 'fixed_asset.depreciate').execute();
    expect(audit).toHaveLength(1);
    expect(audit[0]!.entity_id).toBe(asset.id);
  });

  it('runDepreciation rejects duplicate period', async () => {
    const { biz, ctx, equipment, accumDep, depExpense } = await setup(t);
    const asset = await makeFixedAsset(t.db, biz.id, {
      asset: equipment.id, dep_expense: depExpense.id, accumulated: accumDep.id,
    }, { name: 'Laptop', cost: '2400.0000', salvage_value: '0', useful_life_years: 2 });

    // First run succeeds
    await t.db.transaction().execute(trx =>
      depreciation.runDepreciation(trx, ctx, { fixed_asset_id: asset.id, period_end: '2026-01-31' }),
    );

    // Second run for same period rejected
    await expect(
      t.db.transaction().execute(trx =>
        depreciation.runDepreciation(trx, ctx, { fixed_asset_id: asset.id, period_end: '2026-01-31' }),
      ),
    ).rejects.toMatchObject({ code: ERR.PRECONDITION_FAILED });
  });
});
