import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { startTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import {
  makeFirm, makeBusiness, makeUser, grantAccess,
  makeAccount, seedCoa, seedYearPeriods,
} from '../helpers/factories.js';
import { systemCtx } from '../../src/lib/ctx.js';
import * as ii from '../../src/services/accounting/integrationInboxService.js';

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
  const cash = await makeAccount(t.db, biz.id, { code: '1015', name: 'Cash op', account_type: 'asset' });
  const revenue = await makeAccount(t.db, biz.id, { code: '4001', name: 'Service Revenue', account_type: 'revenue' });
  const ctx = systemCtx({ firm_id: firm.id, business_id: biz.id, user_id: user.id });
  return { biz, user, ctx, cash, revenue };
}

describe('integrationInboxService', () => {
  it('importRows inserts new rows + dedups by external_id', async () => {
    const { biz, ctx } = await bootstrap();
    const r1 = await t.db.transaction().execute(trx =>
      ii.importRows(trx, ctx, { business_id: biz.id, source: 'stripe_csv', rows: [
        { occurred_at: '2026-04-15', description: 'Stripe ch1', amount: '100.00', external_id: 'ch_1' },
        { occurred_at: '2026-04-16', description: 'Stripe ch2', amount: '200.00', external_id: 'ch_2' },
      ] }),
    );
    expect(r1.inserted).toBe(2);
    expect(r1.deduped).toBe(0);

    // Re-import the same external_ids
    const r2 = await t.db.transaction().execute(trx =>
      ii.importRows(trx, ctx, { business_id: biz.id, source: 'stripe_csv', rows: [
        { occurred_at: '2026-04-15', description: 'dup', amount: '100.00', external_id: 'ch_1' },
        { occurred_at: '2026-04-17', description: 'new', amount: '300.00', external_id: 'ch_3' },
      ] }),
    );
    expect(r2.inserted).toBe(1);
    expect(r2.deduped).toBe(1);
  });

  it('categorize on positive amount creates DR cash / CR revenue JE', async () => {
    const { biz, ctx, cash, revenue } = await bootstrap();
    const imported = await t.db.transaction().execute(trx =>
      ii.importRows(trx, ctx, { business_id: biz.id, source: 'stripe_csv', rows: [
        { occurred_at: '2026-04-15', description: 'Charge', amount: '120.00', external_id: 'ch_a' },
      ] }),
    );
    expect(imported.inserted).toBe(1);

    const row = await t.db.selectFrom('integration_inbox').selectAll()
      .where('business_id', '=', biz.id).executeTakeFirstOrThrow();

    const updated = await t.db.transaction().execute(trx =>
      ii.categorize(trx, ctx, { id: row.id, cash_account_id: cash.id, offset_account_id: revenue.id }),
    );
    expect(updated.status).toBe('categorized');
    expect(updated.matched_journal_entry_id).not.toBeNull();

    const lines = await t.db.selectFrom('journal_entry_lines').selectAll()
      .where('journal_entry_id', '=', updated.matched_journal_entry_id!).execute();
    expect(lines).toHaveLength(2);
    const dr = lines.find(l => l.account_id === cash.id);
    const cr = lines.find(l => l.account_id === revenue.id);
    expect(dr?.debit).toBe('120.0000');
    expect(cr?.credit).toBe('120.0000');
  });
});
