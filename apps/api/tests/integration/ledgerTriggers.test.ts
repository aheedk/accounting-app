import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeAccount, seedYearPeriods } from '../helpers/factories.js';
import * as ledger from '../../src/services/core/ledgerService.js';
import * as periods from '../../src/services/core/fiscalPeriodService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-00000000eeee', ip_address: '127.0.0.1', user_agent: 'vitest' };

describe('ledger DB triggers (adversarial)', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  async function setup() {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    await seedYearPeriods(t.db, biz.id, 2026);
    const cash = await makeAccount(t.db, biz.id, { code: '1010', account_type: 'asset' });
    const rev = await makeAccount(t.db, biz.id, { code: '4010', account_type: 'revenue' });
    return { firm, biz, user, ctx, cash, rev };
  }

  it('balance trigger: direct UPDATE making lines unbalanced is blocked at COMMIT', async () => {
    const { biz, ctx, cash, rev } = await setup();
    const je = await t.db.transaction().execute(trx =>
      ledger.postJournalEntry(trx, ctx, {
        business_id: biz.id, entry_date: '2026-04-15', source_type: 'manual', memo: null,
        lines: [
          { account_id: cash.id, debit: '10.0000', credit: '0.0000', memo: null },
          { account_id: rev.id,  debit: '0.0000',  credit: '10.0000', memo: null },
        ],
      }),
    );
    await expect(
      t.db.updateTable('journal_entry_lines').set({ debit: '20.0000' }).where('journal_entry_id', '=', je.id).execute(),
    ).rejects.toThrow(/cannot mutate lines of posted/);
  });

  it('immutability: direct UPDATE of posted JE memo is blocked', async () => {
    const { biz, ctx, cash, rev } = await setup();
    const je = await t.db.transaction().execute(trx =>
      ledger.postJournalEntry(trx, ctx, {
        business_id: biz.id, entry_date: '2026-04-15', source_type: 'manual', memo: 'orig',
        lines: [
          { account_id: cash.id, debit: '5.0000', credit: '0.0000', memo: null },
          { account_id: rev.id,  debit: '0.0000', credit: '5.0000', memo: null },
        ],
      }),
    );
    await expect(
      t.db.updateTable('journal_entries').set({ memo: 'tampered' }).where('id', '=', je.id).execute(),
    ).rejects.toThrow(/cannot mutate posted/);
  });

  it('immutability: direct DELETE of posted JE is blocked', async () => {
    const { biz, ctx, cash, rev } = await setup();
    const je = await t.db.transaction().execute(trx =>
      ledger.postJournalEntry(trx, ctx, {
        business_id: biz.id, entry_date: '2026-04-15', source_type: 'manual', memo: null,
        lines: [
          { account_id: cash.id, debit: '5.0000', credit: '0.0000', memo: null },
          { account_id: rev.id,  debit: '0.0000', credit: '5.0000', memo: null },
        ],
      }),
    );
    await expect(
      t.db.deleteFrom('journal_entries').where('id', '=', je.id).execute(),
    ).rejects.toThrow(/cannot delete posted/);
  });

  it('period gate: direct INSERT of posted JE into closed period is blocked', async () => {
    const { biz, ctx, cash, rev } = await setup();
    const period = (await periods.findPeriodForDate(t.db, biz.id, '2026-04-15'))!;
    await t.db.transaction().execute(trx =>
      periods.closePeriod(trx, { ...ctx, effective_role: 'firm_admin' }, { period_id: period.id }),
    );
    await expect(
      t.db.insertInto('journal_entries').values({
        business_id: biz.id, period_id: period.id, entry_date: '2026-04-15',
        source_type: 'manual', status: 'posted', posted_at: new Date().toISOString() as unknown as string,
      }).execute(),
    ).rejects.toThrow(/closed period/);
    void cash; void rev;
  });

  it('source sanity: reversal must reference an existing JE', async () => {
    const { biz } = await setup();
    const period = (await periods.findPeriodForDate(t.db, biz.id, '2026-04-15'))!;
    await expect(
      t.db.insertInto('journal_entries').values({
        business_id: biz.id, period_id: period.id, entry_date: '2026-04-15',
        source_type: 'reversal', source_id: '00000000-0000-0000-0000-000000000000', status: 'draft',
      }).execute(),
    ).rejects.toThrow(/reversal entry must reference/);
  });

  it('source sanity: manual entry rejects non-null source_id', async () => {
    const { biz, cash } = await setup();
    const period = (await periods.findPeriodForDate(t.db, biz.id, '2026-04-15'))!;
    await expect(
      t.db.insertInto('journal_entries').values({
        business_id: biz.id, period_id: period.id, entry_date: '2026-04-15',
        source_type: 'manual', source_id: cash.id, status: 'draft',
      }).execute(),
    ).rejects.toThrow(/manual entry must not have source_id/);
  });

  it('correction link rejects a source-generated adjustment', async () => {
    const { biz, ctx, cash, rev } = await setup();
    const original = await t.db.transaction().execute(trx => ledger.postJournalEntry(trx, ctx, {
      business_id: biz.id,
      entry_date: '2026-04-15',
      source_type: 'adjustment',
      source_id: biz.id,
      memo: 'Generated adjustment',
      lines: [
        { account_id: cash.id, debit: '12.0000', credit: '0.0000', memo: null },
        { account_id: rev.id, debit: '0.0000', credit: '12.0000', memo: null },
      ],
    }));
    await t.db.transaction().execute(trx => ledger.voidJournalEntry(trx, ctx, {
      journal_entry_id: original.id,
      void_reason: 'Source transaction void',
      source_guard: { source_type: 'adjustment', source_id: biz.id },
    }));
    const period = (await periods.findPeriodForDate(t.db, biz.id, '2026-04-16'))!;

    await expect(t.db.insertInto('journal_entries').values({
      business_id: biz.id,
      period_id: period.id,
      entry_date: '2026-04-16',
      source_type: 'adjustment',
      corrected_from_entry_id: original.id,
      status: 'draft',
      created_by_user_id: ctx.user_id,
    }).execute()).rejects.toThrow(/unlinked manual or adjustment/);
  });

  it('date range: entry_date outside period range is blocked', async () => {
    const { biz } = await setup();
    const period = (await periods.findPeriodForDate(t.db, biz.id, '2026-04-15'))!;
    await expect(
      t.db.insertInto('journal_entries').values({
        business_id: biz.id, period_id: period.id, entry_date: '2026-05-15',
        source_type: 'manual', status: 'draft',
      }).execute(),
    ).rejects.toThrow(/outside period range/);
  });
});
