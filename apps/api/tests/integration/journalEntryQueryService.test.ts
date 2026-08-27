import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ERR } from '@accounting/shared';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeAccount, makeBusiness, makeFirm, makeUser, seedYearPeriods } from '../helpers/factories.js';
import * as ledger from '../../src/services/core/ledgerService.js';
import * as periods from '../../src/services/core/fiscalPeriodService.js';
import * as journalQueries from '../../src/services/core/journalEntryQueryService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = {
  request_id: '00000000-0000-0000-0000-00000000ab12',
  ip_address: '127.0.0.1',
  user_agent: 'vitest',
};

async function setup(t: TestDb) {
  const firm = await makeFirm(t.db);
  const business = await makeBusiness(t.db, firm.id, 'Journal Query Biz');
  const user = await makeUser(t.db, firm.id, { role: 'accountant' });
  const ctx: ServiceCtx = {
    user_id: user.id,
    firm_id: firm.id,
    business_id: business.id,
    effective_role: 'accountant',
    ...meta,
  };
  await seedYearPeriods(t.db, business.id, 2026);
  const cash = await makeAccount(t.db, business.id, { code: '1010', name: 'Cash', account_type: 'asset' });
  const revenue = await makeAccount(t.db, business.id, { code: '4010', name: 'Sales', account_type: 'revenue' });
  return { business, ctx, cash, revenue };
}

async function postEntry(
  t: TestDb,
  setupData: Awaited<ReturnType<typeof setup>>,
  entryDate: string,
  memo: string,
) {
  const { business, ctx, cash, revenue } = setupData;
  return t.db.transaction().execute(trx => ledger.postJournalEntry(trx, ctx, {
    business_id: business.id,
    entry_date: entryDate,
    source_type: 'manual',
    memo,
    reference: `JE-${entryDate}`,
    lines: [
      {
        account_id: cash.id,
        debit: '100.0000',
        credit: '0.0000',
        memo: 'Cash line',
        name: 'Patient A',
        class_name: 'Clinic',
      },
      { account_id: revenue.id, debit: '0.0000', credit: '100.0000', memo: 'Sales line' },
    ],
  }));
}

describe('journalEntryQueryService', () => {
  let t: TestDb;

  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('lists only entries in the requested period with account-enriched lines', async () => {
    const data = await setup(t);
    const april = await postEntry(t, data, '2026-04-15', 'April entry');
    await postEntry(t, data, '2026-05-02', 'May entry');

    const result = await journalQueries.listJournalEntries(t.db, data.ctx, {
      period_start: '2026-04-01',
      period_end: '2026-04-30',
      limit: 50,
      offset: 0,
    });

    expect(result).toMatchObject({ limit: 50, offset: 0 });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({ id: april.id, memo: 'April entry' });
    expect(result.entries[0]!.lines[0]).toMatchObject({
      account_code: '1010',
      account_name: 'Cash',
      name: 'Patient A',
      class_name: 'Clinic',
      debit: '100.0000',
    });
  });

  it('can list recently created entries even when the newest one is backdated', async () => {
    const data = await setup(t);
    await postEntry(t, data, '2026-05-02', 'Created first');
    const backdated = await postEntry(t, data, '2026-04-15', 'Created second');

    const result = await journalQueries.listJournalEntries(t.db, data.ctx, {
      sort: 'recent',
      limit: 10,
      offset: 0,
    });

    expect(result.entries[0]?.id).toBe(backdated.id);
  });

  it('returns an editable posted manual entry for an accountant', async () => {
    const data = await setup(t);
    const entry = await postEntry(t, data, '2026-04-15', 'Editable entry');

    const result = await journalQueries.getJournalEntryDetail(t.db, data.ctx, entry.id);

    expect(result.entry).toMatchObject({
      id: entry.id,
      period_status: 'open',
      source_type: 'manual',
    });
    expect(result.can_correct).toBe(true);
    expect(result.correction_block_reason).toBeNull();
    expect(result.can_reverse).toBe(true);
    expect(result.reversal_block_reason).toBeNull();
    expect(result.is_standalone_manual).toBe(true);
    expect(result.lines).toHaveLength(2);
  });

  it('returns a specific read-only reason for generated entries and staff viewers', async () => {
    const data = await setup(t);
    const original = await postEntry(t, data, '2026-04-15', 'Original entry');
    const reversal = await t.db.transaction().execute(trx => ledger.voidJournalEntry(trx, data.ctx, {
      journal_entry_id: original.id,
      void_reason: 'Create generated reversal',
      reversal_date: original.entry_date,
    }));

    const generatedDetail = await journalQueries.getJournalEntryDetail(t.db, data.ctx, reversal.id);
    expect(generatedDetail.can_correct).toBe(false);
    expect(generatedDetail.correction_block_reason).toMatch(/source transaction/i);
    expect(generatedDetail.can_reverse).toBe(false);
    expect(generatedDetail.reversal_block_reason).toMatch(/source transaction/i);
    expect(generatedDetail.is_standalone_manual).toBe(false);

    const replacement = await postEntry(t, data, '2026-05-02', 'Staff cannot edit');
    const staffDetail = await journalQueries.getJournalEntryDetail(
      t.db,
      { ...data.ctx, effective_role: 'staff' },
      replacement.id,
    );
    expect(staffDetail.can_correct).toBe(false);
    expect(staffDetail.correction_block_reason).toMatch(/accountant access/i);
  });

  it('treats source-linked adjustments as generated and read-only', async () => {
    const data = await setup(t);
    const generated = await t.db.transaction().execute(trx => ledger.postJournalEntry(trx, data.ctx, {
      business_id: data.business.id,
      entry_date: '2026-04-15',
      source_type: 'adjustment',
      source_id: data.business.id,
      memo: 'Generated adjustment',
      lines: [
        { account_id: data.cash.id, debit: '15.0000', credit: '0.0000', memo: null },
        { account_id: data.revenue.id, debit: '0.0000', credit: '15.0000', memo: null },
      ],
    }));

    const detail = await journalQueries.getJournalEntryDetail(t.db, data.ctx, generated.id);
    expect(detail.can_correct).toBe(false);
    expect(detail.correction_block_reason).toMatch(/source transaction/i);
  });

  it('marks an entry with a standalone reversal read-only for further correction or reversal', async () => {
    const data = await setup(t);
    const original = await postEntry(t, data, '2026-04-15', 'Reversed entry');
    await t.db.transaction().execute(trx => ledger.reverseJournalEntry(trx, data.ctx, {
      journal_entry_id: original.id,
    }));

    const detail = await journalQueries.getJournalEntryDetail(t.db, data.ctx, original.id);
    expect(detail.can_correct).toBe(false);
    expect(detail.correction_block_reason).toMatch(/already been reversed/i);
    expect(detail.can_reverse).toBe(false);
    expect(detail.reversal_block_reason).toMatch(/already been reversed/i);
  });

  it('marks entries in closed periods read-only and hides cross-business IDs', async () => {
    const data = await setup(t);
    const entry = await postEntry(t, data, '2026-04-15', 'Closing entry');
    const period = (await periods.findPeriodForDate(t.db, data.business.id, entry.entry_date))!;
    await t.db.transaction().execute(trx => periods.closePeriod(
      trx,
      { ...data.ctx, effective_role: 'firm_admin' },
      { period_id: period.id },
    ));

    const detail = await journalQueries.getJournalEntryDetail(t.db, data.ctx, entry.id);
    expect(detail.can_correct).toBe(false);
    expect(detail.correction_block_reason).toMatch(/closed/i);

    const otherFirm = await makeFirm(t.db, 'Other Firm');
    const otherBusiness = await makeBusiness(t.db, otherFirm.id, 'Other Business');
    const foreignCtx = { ...data.ctx, firm_id: otherFirm.id, business_id: otherBusiness.id };
    await expect(journalQueries.getJournalEntryDetail(t.db, foreignCtx, entry.id))
      .rejects.toMatchObject({ code: ERR.NOT_FOUND });
  });
});
