import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeAccount, seedYearPeriods } from '../helpers/factories.js';
import * as ledger from '../../src/services/core/ledgerService.js';
import * as periods from '../../src/services/core/fiscalPeriodService.js';
import * as override from '../../src/services/admin/adminOverrideService.js';
import { ERR } from '@accounting/shared';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-00000000cccc', ip_address: '127.0.0.1', user_agent: 'vitest' };

describe('adminOverrideService', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('runWithClosedPeriodOverride: requires firm_admin', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const acct = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: acct.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    await expect(
      override.runWithClosedPeriodOverride(t.db, ctx, 'just because', async () => {}),
    ).rejects.toMatchObject({ code: ERR.FORBIDDEN });
  });

  it('writes admin_override_post audit row BEFORE the wrapped action runs (rollback case)', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const admin = await makeUser(t.db, firm.id, { role: 'firm_admin' });
    const ctx: ServiceCtx = { user_id: admin.id, firm_id: firm.id, business_id: biz.id, effective_role: 'firm_admin', ...meta };

    await expect(
      override.runWithClosedPeriodOverride(t.db, ctx, 'late adjustment', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const audits = await t.db.selectFrom('audit_logs').selectAll().execute();
    expect(audits.find(a => a.action === 'fiscal_period.admin_override_post')).toBeUndefined();
  });

  it('allows post into closed period when wrapped; audit row present after commit', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const admin = await makeUser(t.db, firm.id, { role: 'firm_admin' });
    const ctx: ServiceCtx = { user_id: admin.id, firm_id: firm.id, business_id: biz.id, effective_role: 'firm_admin', ...meta };
    await seedYearPeriods(t.db, biz.id, 2026);
    const period = (await periods.findPeriodForDate(t.db, biz.id, '2026-04-15'))!;
    await t.db.transaction().execute(trx => periods.closePeriod(trx, ctx, { period_id: period.id }));
    const cash = await makeAccount(t.db, biz.id, { code: '1010', account_type: 'asset' });
    const revenue = await makeAccount(t.db, biz.id, { code: '4010', account_type: 'revenue' });

    const je = await override.runWithClosedPeriodOverride(t.db, ctx, 'late adjustment for tax', async (trx) =>
      ledger.postJournalEntry(trx, ctx, {
        business_id: biz.id, entry_date: '2026-04-15', source_type: 'adjustment', memo: 'late',
        lines: [
          { account_id: cash.id,    debit: '50.0000', credit: '0.0000',  memo: null },
          { account_id: revenue.id, debit: '0.0000',  credit: '50.0000', memo: null },
        ],
      }),
    );
    expect(je.status).toBe('posted');

    const audits = await t.db.selectFrom('audit_logs').selectAll().orderBy('created_at').execute();
    const overrideRow = audits.find(a => a.action === 'fiscal_period.admin_override_post');
    expect(overrideRow).toBeTruthy();
    expect(overrideRow!.after_state).toMatchObject({ reason: 'late adjustment for tax' });
  });
});
