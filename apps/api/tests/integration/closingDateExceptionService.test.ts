import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeAccount, seedYearPeriods } from '../helpers/factories.js';
import * as ledger from '../../src/services/core/ledgerService.js';
import * as periods from '../../src/services/core/fiscalPeriodService.js';
import * as override from '../../src/services/admin/adminOverrideService.js';
import { closingDateExceptions } from '../../src/services/core/closingDateExceptionService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-00000000cdce', ip_address: '127.0.0.1', user_agent: 'vitest' };

describe('closingDateExceptionService', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('lists an entry posted into a closed period after it closed, under override', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const admin = await makeUser(t.db, firm.id, { role: 'firm_admin', full_name: 'Pat Admin' });
    const ctx: ServiceCtx = { user_id: admin.id, firm_id: firm.id, business_id: biz.id, effective_role: 'firm_admin', ...meta };
    await seedYearPeriods(t.db, biz.id, 2026);
    const period = (await periods.findPeriodForDate(t.db, biz.id, '2026-04-15'))!;
    await t.db.transaction().execute(trx => periods.closePeriod(trx, ctx, { period_id: period.id }));
    const cash = await makeAccount(t.db, biz.id, { code: '1010', account_type: 'asset' });
    const revenue = await makeAccount(t.db, biz.id, { code: '4010', account_type: 'revenue' });

    const je = await override.runWithClosedPeriodOverride(t.db, ctx, 'late adjustment for tax', async trx =>
      ledger.postJournalEntry(trx, ctx, {
        business_id: biz.id, entry_date: '2026-04-15', source_type: 'adjustment', memo: 'Late tax true-up',
        lines: [
          { account_id: cash.id, debit: '50.0000', credit: '0.0000', memo: null },
          { account_id: revenue.id, debit: '0.0000', credit: '50.0000', memo: null },
        ],
      }),
    );

    const exceptions = await closingDateExceptions(t.db, biz.id);
    expect(exceptions).toHaveLength(1);
    expect(exceptions[0]).toMatchObject({
      journal_entry_id: je.id, entry_date: '2026-04-15', reason: 'posted_after_close',
      amount: '50.0000', who: 'Pat Admin', memo: 'Late tax true-up',
    });
  });

  it('lists an entry that was posted before close, then voided after close, under override', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const admin = await makeUser(t.db, firm.id, { role: 'firm_admin', full_name: 'Sam Admin' });
    const ctx: ServiceCtx = { user_id: admin.id, firm_id: firm.id, business_id: biz.id, effective_role: 'firm_admin', ...meta };
    await seedYearPeriods(t.db, biz.id, 2026);
    const cash = await makeAccount(t.db, biz.id, { code: '1010', account_type: 'asset' });
    const revenue = await makeAccount(t.db, biz.id, { code: '4010', account_type: 'revenue' });

    const je = await t.db.transaction().execute(trx => ledger.postJournalEntry(trx, ctx, {
      business_id: biz.id, entry_date: '2026-04-10', source_type: 'manual', memo: 'Normal sale',
      lines: [
        { account_id: cash.id, debit: '75.0000', credit: '0.0000', memo: null },
        { account_id: revenue.id, debit: '0.0000', credit: '75.0000', memo: null },
      ],
    }));

    const period = (await periods.findPeriodForDate(t.db, biz.id, '2026-04-10'))!;
    await t.db.transaction().execute(trx => periods.closePeriod(trx, ctx, { period_id: period.id }));

    await override.runWithClosedPeriodOverride(t.db, ctx, 'found an error after closing', async trx =>
      ledger.voidJournalEntry(trx, ctx, { journal_entry_id: je.id, void_reason: 'Duplicate entry' }),
    );

    // Two real exceptions, not one: the original was voided after close, AND
    // voiding posts a genuine new reversal entry, which itself also lands in
    // the closed period after it closed — both are real changes to what the
    // period's own numbers say, so both belong on the report.
    const exceptions = await closingDateExceptions(t.db, biz.id);
    expect(exceptions).toHaveLength(2);
    const original = exceptions.find(e => e.journal_entry_id === je.id);
    expect(original).toMatchObject({ reason: 'voided_after_close', who: 'Sam Admin' });
    const reversal = exceptions.find(e => e.journal_entry_id !== je.id);
    expect(reversal).toMatchObject({ reason: 'posted_after_close', who: 'Sam Admin' });
  });

  it('lists nothing for a period closed with no late activity', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const admin = await makeUser(t.db, firm.id, { role: 'firm_admin' });
    const ctx: ServiceCtx = { user_id: admin.id, firm_id: firm.id, business_id: biz.id, effective_role: 'firm_admin', ...meta };
    await seedYearPeriods(t.db, biz.id, 2026);
    const cash = await makeAccount(t.db, biz.id, { code: '1010', account_type: 'asset' });
    const revenue = await makeAccount(t.db, biz.id, { code: '4010', account_type: 'revenue' });
    await t.db.transaction().execute(trx => ledger.postJournalEntry(trx, ctx, {
      business_id: biz.id, entry_date: '2026-04-10', source_type: 'manual', memo: 'Normal sale',
      lines: [
        { account_id: cash.id, debit: '20.0000', credit: '0.0000', memo: null },
        { account_id: revenue.id, debit: '0.0000', credit: '20.0000', memo: null },
      ],
    }));
    const period = (await periods.findPeriodForDate(t.db, biz.id, '2026-04-10'))!;
    await t.db.transaction().execute(trx => periods.closePeriod(trx, ctx, { period_id: period.id }));

    expect(await closingDateExceptions(t.db, biz.id)).toEqual([]);
  });
});
