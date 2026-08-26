import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeAccount, seedYearPeriods } from '../helpers/factories.js';
import * as ledger from '../../src/services/core/ledgerService.js';
import * as periods from '../../src/services/core/fiscalPeriodService.js';
import { ERR } from '@accounting/shared';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-00000000bbbb', ip_address: '127.0.0.1', user_agent: 'vitest' };

async function setup(t: TestDb) {
  const firm = await makeFirm(t.db);
  const biz = await makeBusiness(t.db, firm.id, 'Biz');
  const user = await makeUser(t.db, firm.id, { role: 'accountant' });
  const ctx: ServiceCtx = {
    user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant',
    ...meta,
  };
  await seedYearPeriods(t.db, biz.id, 2026);
  const cash = await makeAccount(t.db, biz.id, { code: '1010', name: 'Cash', account_type: 'asset' });
  const revenue = await makeAccount(t.db, biz.id, { code: '4010', name: 'Sales', account_type: 'revenue' });
  return { firm, biz, user, ctx, cash, revenue };
}

describe('ledgerService.postJournalEntry', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('posts a balanced manual JE; status=posted; lines persisted; audit row written', async () => {
    const { biz, ctx, cash, revenue } = await setup(t);
    const je = await t.db.transaction().execute(trx =>
      ledger.postJournalEntry(trx, ctx, {
        business_id: biz.id, entry_date: '2026-04-15', source_type: 'manual',
        memo: 'Cash sale',
        lines: [
          {
            account_id: cash.id,
            debit: '100.0000',
            credit: '0.0000',
            memo: null,
            name: 'Patient A',
            class_name: 'Clinic',
          },
          { account_id: revenue.id, debit: '0.0000',   credit: '100.0000', memo: null },
        ],
      }),
    );
    expect(je.status).toBe('posted');
    const lines = await t.db.selectFrom('journal_entry_lines').selectAll().where('journal_entry_id', '=', je.id).orderBy('line_number').execute();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      debit: '100.0000',
      name: 'Patient A',
      class_name: 'Clinic',
    });
    expect(lines[1]!.credit).toBe('100.0000');
    const audit = await t.db.selectFrom('audit_logs').selectAll().where('action', '=', 'journal_entry.post').execute();
    expect(audit).toHaveLength(1);
  });

  it('rejects unbalanced entry with UNBALANCED_ENTRY (service-layer guard)', async () => {
    const { biz, ctx, cash, revenue } = await setup(t);
    await expect(
      t.db.transaction().execute(trx =>
        ledger.postJournalEntry(trx, ctx, {
          business_id: biz.id, entry_date: '2026-04-15', source_type: 'manual', memo: null,
          lines: [
            { account_id: cash.id,    debit: '100.0000', credit: '0.0000',  memo: null },
            { account_id: revenue.id, debit: '0.0000',   credit: '99.0000', memo: null },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: ERR.UNBALANCED_ENTRY });
  });

  it('rejects post into a closed period without override', async () => {
    const { biz, ctx, cash, revenue } = await setup(t);
    const period = (await periods.findPeriodForDate(t.db, biz.id, '2026-04-15'))!;
    await t.db.transaction().execute(trx => periods.closePeriod(trx, { ...ctx, effective_role: 'firm_admin' }, { period_id: period.id }));
    await expect(
      t.db.transaction().execute(trx =>
        ledger.postJournalEntry(trx, ctx, {
          business_id: biz.id, entry_date: '2026-04-15', source_type: 'manual', memo: null,
          lines: [
            { account_id: cash.id,    debit: '50.0000', credit: '0.0000',  memo: null },
            { account_id: revenue.id, debit: '0.0000',  credit: '50.0000', memo: null },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: ERR.CLOSED_PERIOD });
  });

  it('rejects post when only one line provided', async () => {
    const { biz, ctx, cash } = await setup(t);
    await expect(
      t.db.transaction().execute(trx =>
        ledger.postJournalEntry(trx, ctx, {
          business_id: biz.id, entry_date: '2026-04-15', source_type: 'manual', memo: null,
          lines: [{ account_id: cash.id, debit: '50.0000', credit: '0.0000', memo: null }],
        }),
      ),
    ).rejects.toMatchObject({ code: ERR.PRECONDITION_FAILED });
  });

  it('rejects accounts from another business', async () => {
    const { firm, biz, ctx, cash } = await setup(t);
    const otherBusiness = await makeBusiness(t.db, firm.id, 'Other Biz');
    const otherRevenue = await makeAccount(t.db, otherBusiness.id, {
      code: '4020',
      name: 'Other Sales',
      account_type: 'revenue',
    });

    await expect(
      t.db.transaction().execute(trx =>
        ledger.postJournalEntry(trx, ctx, {
          business_id: biz.id,
          entry_date: '2026-04-15',
          source_type: 'manual',
          memo: null,
          lines: [
            { account_id: cash.id, debit: '10.0000', credit: '0.0000', memo: null },
            { account_id: otherRevenue.id, debit: '0.0000', credit: '10.0000', memo: null },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: ERR.PRECONDITION_FAILED });
  });

  it('voidJournalEntry creates a reversing entry and flips original to voided', async () => {
    const { biz, ctx, cash, revenue } = await setup(t);
    const je = await t.db.transaction().execute(trx =>
      ledger.postJournalEntry(trx, ctx, {
        business_id: biz.id, entry_date: '2026-04-15', source_type: 'manual', memo: 'orig',
        lines: [
          { account_id: cash.id,    debit: '100.0000', credit: '0.0000',   memo: null },
          { account_id: revenue.id, debit: '0.0000',   credit: '100.0000', memo: null },
        ],
      }),
    );
    const reversal = await t.db.transaction().execute(trx =>
      ledger.voidJournalEntry(trx, ctx, { journal_entry_id: je.id, void_reason: 'data entry error' }),
    );
    expect(reversal.id).not.toBe(je.id);
    expect(reversal.source_type).toBe('reversal');
    expect(reversal.reversed_entry_id).toBe(je.id);
    const reversalLines = await t.db.selectFrom('journal_entry_lines').selectAll().where('journal_entry_id', '=', reversal.id).orderBy('line_number').execute();
    expect(reversalLines).toHaveLength(2);
    const reversedCashLine = reversalLines.find(l => l.account_id === cash.id)!;
    expect(reversedCashLine.credit).toBe('100.0000');
    expect(reversedCashLine.debit).toBe('0.0000');
    const orig = await t.db.selectFrom('journal_entries').selectAll().where('id', '=', je.id).executeTakeFirstOrThrow();
    expect(orig.status).toBe('voided');
    expect(orig.void_reason).toBe('data entry error');
  });

  it('voidJournalEntry rejects voiding an already-voided entry', async () => {
    const { biz, ctx, cash, revenue } = await setup(t);
    const je = await t.db.transaction().execute(trx =>
      ledger.postJournalEntry(trx, ctx, {
        business_id: biz.id, entry_date: '2026-04-15', source_type: 'manual', memo: null,
        lines: [
          { account_id: cash.id,    debit: '10.0000', credit: '0.0000',  memo: null },
          { account_id: revenue.id, debit: '0.0000',  credit: '10.0000', memo: null },
        ],
      }),
    );
    await t.db.transaction().execute(trx => ledger.voidJournalEntry(trx, ctx, { journal_entry_id: je.id, void_reason: 'oops' }));
    await expect(
      t.db.transaction().execute(trx => ledger.voidJournalEntry(trx, ctx, { journal_entry_id: je.id, void_reason: 'oops again' })),
    ).rejects.toMatchObject({ code: ERR.INVALID_STATE_TRANSITION });
  });

  it('hides a void target belonging to another business', async () => {
    const { firm, ctx } = await setup(t);
    const otherBusiness = await makeBusiness(t.db, firm.id, 'Other Void Biz');
    await seedYearPeriods(t.db, otherBusiness.id, 2026);
    const otherCash = await makeAccount(t.db, otherBusiness.id, {
      code: '1115', name: 'Other Cash', account_type: 'asset',
    });
    const otherRevenue = await makeAccount(t.db, otherBusiness.id, {
      code: '4115', name: 'Other Sales', account_type: 'revenue',
    });
    const otherEntry = await t.db.transaction().execute(trx =>
      ledger.postJournalEntry(trx, { ...ctx, business_id: otherBusiness.id }, {
        business_id: otherBusiness.id,
        entry_date: '2026-04-15',
        source_type: 'manual',
        memo: 'Other business entry',
        lines: [
          { account_id: otherCash.id, debit: '20.0000', credit: '0.0000', memo: null },
          { account_id: otherRevenue.id, debit: '0.0000', credit: '20.0000', memo: null },
        ],
      }),
    );

    await expect(t.db.transaction().execute(trx => ledger.voidJournalEntry(trx, ctx, {
      journal_entry_id: otherEntry.id,
      void_reason: 'Cross-business attempt',
    }))).rejects.toMatchObject({ code: ERR.NOT_FOUND });

    const unchanged = await t.db.selectFrom('journal_entries').selectAll()
      .where('id', '=', otherEntry.id).executeTakeFirstOrThrow();
    expect(unchanged.status).toBe('posted');
  });

  it('requires a matching source guard to void a source-generated entry', async () => {
    const { biz, ctx, cash, revenue } = await setup(t);
    const sourceId = biz.id;
    const generated = await t.db.transaction().execute(trx =>
      ledger.postJournalEntry(trx, ctx, {
        business_id: biz.id,
        entry_date: '2026-04-15',
        source_type: 'adjustment',
        source_id: sourceId,
        memo: 'Generated adjustment',
        lines: [
          { account_id: cash.id, debit: '25.0000', credit: '0.0000', memo: null },
          { account_id: revenue.id, debit: '0.0000', credit: '25.0000', memo: null },
        ],
      }),
    );

    await expect(t.db.transaction().execute(trx => ledger.voidJournalEntry(trx, ctx, {
      journal_entry_id: generated.id,
      void_reason: 'Public journal void attempt',
    }))).rejects.toMatchObject({ code: ERR.IMMUTABLE_RECORD });

    await expect(t.db.transaction().execute(trx => ledger.voidJournalEntry(trx, ctx, {
      journal_entry_id: generated.id,
      void_reason: 'Wrong source owner',
      source_guard: { source_type: 'adjustment', source_id: cash.id },
    }))).rejects.toMatchObject({ code: ERR.IMMUTABLE_RECORD });

    const reversal = await t.db.transaction().execute(trx => ledger.voidJournalEntry(trx, ctx, {
      journal_entry_id: generated.id,
      void_reason: 'Source transaction void',
      source_guard: { source_type: 'adjustment', source_id: sourceId },
    }));
    expect(reversal.reversed_entry_id).toBe(generated.id);
  });

  it('serializes simultaneous voids so only one reversal is posted', async () => {
    const { biz, ctx, cash, revenue } = await setup(t);
    const original = await t.db.transaction().execute(trx =>
      ledger.postJournalEntry(trx, ctx, {
        business_id: biz.id,
        entry_date: '2026-04-15',
        source_type: 'manual',
        memo: 'Concurrent void target',
        lines: [
          { account_id: cash.id, debit: '30.0000', credit: '0.0000', memo: null },
          { account_id: revenue.id, debit: '0.0000', credit: '30.0000', memo: null },
        ],
      }),
    );

    let releaseFirst!: () => void;
    const holdFirst = new Promise<void>(resolve => { releaseFirst = resolve; });
    let firstReady!: () => void;
    const firstHasVoided = new Promise<void>(resolve => { firstReady = resolve; });
    const first = t.db.transaction().execute(async trx => {
      const reversal = await ledger.voidJournalEntry(trx, ctx, {
        journal_entry_id: original.id,
        void_reason: 'First simultaneous void',
      });
      firstReady();
      await holdFirst;
      return reversal;
    });

    await firstHasVoided;
    const second = t.db.transaction().execute(trx => ledger.voidJournalEntry(trx, ctx, {
      journal_entry_id: original.id,
      void_reason: 'Second simultaneous void',
    }));
    const secondState = await Promise.race([
      second.then(() => 'settled', () => 'settled'),
      new Promise<'blocked'>(resolve => setTimeout(() => resolve('blocked'), 75)),
    ]);
    expect(secondState).toBe('blocked');

    releaseFirst();
    const results = await Promise.allSettled([first, second]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({
      reason: { code: ERR.INVALID_STATE_TRANSITION },
    });

    const reversals = await t.db.selectFrom('journal_entries').selectAll()
      .where('reversed_entry_id', '=', original.id).execute();
    expect(reversals).toHaveLength(1);
  });

  it('atomically corrects a posted manual entry with a same-date reversal and linked replacement', async () => {
    const { biz, ctx, cash, revenue } = await setup(t);
    const original = await t.db.transaction().execute(trx =>
      ledger.postJournalEntry(trx, ctx, {
        business_id: biz.id,
        entry_date: '2026-04-15',
        source_type: 'manual',
        memo: 'Original cash sale',
        reference: 'JE-22',
        lines: [
          {
            account_id: cash.id,
            debit: '100.0000',
            credit: '0.0000',
            memo: 'Original debit',
            name: 'Patient A',
            class_name: 'Clinic',
          },
          {
            account_id: revenue.id,
            debit: '0.0000',
            credit: '100.0000',
            memo: 'Original credit',
          },
        ],
      }),
    );

    const result = await t.db.transaction().execute(trx =>
      ledger.correctJournalEntry(trx, ctx, {
        journal_entry_id: original.id,
        replacement: {
          business_id: biz.id,
          entry_date: '2026-05-02',
          source_type: 'adjustment',
          memo: 'Corrected cash sale',
          reference: 'AJE-22',
          lines: [
            {
              account_id: cash.id,
              debit: '125.0000',
              credit: '0.0000',
              memo: 'Correct debit',
              name: 'Patient A',
              class_name: 'Clinic',
            },
            {
              account_id: revenue.id,
              debit: '0.0000',
              credit: '125.0000',
              memo: 'Correct credit',
            },
          ],
        },
      }),
    );

    expect(result.original).toMatchObject({ id: original.id, status: 'voided' });
    expect(result.reversal).toMatchObject({
      entry_date: '2026-04-15',
      reversed_entry_id: original.id,
      source_type: 'reversal',
      status: 'posted',
    });
    expect(result.corrected_entry).toMatchObject({
      entry_date: '2026-05-02',
      source_type: 'adjustment',
      corrected_from_entry_id: original.id,
      status: 'posted',
      reference: 'AJE-22',
    });

    const reversalLines = await t.db.selectFrom('journal_entry_lines').selectAll()
      .where('journal_entry_id', '=', result.reversal.id).orderBy('line_number').execute();
    expect(reversalLines[0]).toMatchObject({
      account_id: cash.id,
      debit: '0.0000',
      credit: '100.0000',
      name: 'Patient A',
      class_name: 'Clinic',
    });

    const correctedLines = await t.db.selectFrom('journal_entry_lines').selectAll()
      .where('journal_entry_id', '=', result.corrected_entry.id).orderBy('line_number').execute();
    expect(correctedLines[0]).toMatchObject({
      account_id: cash.id,
      debit: '125.0000',
      credit: '0.0000',
      memo: 'Correct debit',
      name: 'Patient A',
      class_name: 'Clinic',
    });

    const updateAudit = await t.db.selectFrom('audit_logs').selectAll()
      .where('action', '=', 'journal_entry.update').executeTakeFirstOrThrow();
    expect(updateAudit.entity_id).toBe(original.id);
    expect(updateAudit.after_state).toMatchObject({
      original_id: original.id,
      reversal_id: result.reversal.id,
      corrected_entry_id: result.corrected_entry.id,
    });
  });

  it('rejects correction of a generated reversal entry and leaves it posted', async () => {
    const { biz, ctx, cash, revenue } = await setup(t);
    const original = await t.db.transaction().execute(trx =>
      ledger.postJournalEntry(trx, ctx, {
        business_id: biz.id,
        entry_date: '2026-04-15',
        source_type: 'manual',
        memo: 'Entry to reverse',
        lines: [
          { account_id: cash.id, debit: '40.0000', credit: '0.0000', memo: null },
          { account_id: revenue.id, debit: '0.0000', credit: '40.0000', memo: null },
        ],
      }),
    );
    const generated = await t.db.transaction().execute(trx =>
      ledger.voidJournalEntry(trx, ctx, {
        journal_entry_id: original.id,
        void_reason: 'Create a generated reversal for the test',
        reversal_date: original.entry_date,
      }),
    );

    await expect(t.db.transaction().execute(trx =>
      ledger.correctJournalEntry(trx, ctx, {
        journal_entry_id: generated.id,
        replacement: {
          business_id: biz.id,
          entry_date: '2026-04-16',
          source_type: 'manual',
          memo: 'Should not post',
          lines: [
            { account_id: cash.id, debit: '50.0000', credit: '0.0000', memo: null },
            { account_id: revenue.id, debit: '0.0000', credit: '50.0000', memo: null },
          ],
        },
      }),
    )).rejects.toMatchObject({ code: ERR.IMMUTABLE_RECORD });

    const after = await t.db.selectFrom('journal_entries').selectAll()
      .where('id', '=', generated.id).executeTakeFirstOrThrow();
    expect(after.status).toBe('posted');
  });

  it('rejects correction of a source-linked adjustment', async () => {
    const { biz, ctx, cash, revenue } = await setup(t);
    const generated = await t.db.transaction().execute(trx =>
      ledger.postJournalEntry(trx, ctx, {
        business_id: biz.id,
        entry_date: '2026-04-15',
        source_type: 'adjustment',
        source_id: biz.id,
        memo: 'Opening balance style adjustment',
        lines: [
          { account_id: cash.id, debit: '45.0000', credit: '0.0000', memo: null },
          { account_id: revenue.id, debit: '0.0000', credit: '45.0000', memo: null },
        ],
      }),
    );

    await expect(t.db.transaction().execute(trx => ledger.correctJournalEntry(trx, ctx, {
      journal_entry_id: generated.id,
      replacement: {
        business_id: biz.id,
        entry_date: '2026-04-16',
        source_type: 'adjustment',
        memo: 'Should not post',
        lines: [
          { account_id: cash.id, debit: '50.0000', credit: '0.0000', memo: null },
          { account_id: revenue.id, debit: '0.0000', credit: '50.0000', memo: null },
        ],
      },
    }))).rejects.toMatchObject({ code: ERR.IMMUTABLE_RECORD });

    const unchanged = await t.db.selectFrom('journal_entries').selectAll()
      .where('id', '=', generated.id).executeTakeFirstOrThrow();
    expect(unchanged.status).toBe('posted');
  });

  it('rejects correction when the caller lacks accountant access', async () => {
    const { biz, ctx, cash, revenue } = await setup(t);
    const original = await t.db.transaction().execute(trx =>
      ledger.postJournalEntry(trx, ctx, {
        business_id: biz.id,
        entry_date: '2026-04-15',
        source_type: 'manual',
        memo: null,
        lines: [
          { account_id: cash.id, debit: '30.0000', credit: '0.0000', memo: null },
          { account_id: revenue.id, debit: '0.0000', credit: '30.0000', memo: null },
        ],
      }),
    );

    await expect(t.db.transaction().execute(trx =>
      ledger.correctJournalEntry(trx, { ...ctx, effective_role: 'staff' }, {
        journal_entry_id: original.id,
        replacement: {
          business_id: biz.id,
          entry_date: '2026-04-16',
          source_type: 'manual',
          memo: null,
          lines: [
            { account_id: cash.id, debit: '35.0000', credit: '0.0000', memo: null },
            { account_id: revenue.id, debit: '0.0000', credit: '35.0000', memo: null },
          ],
        },
      }),
    )).rejects.toMatchObject({ code: ERR.FORBIDDEN });

    const after = await t.db.selectFrom('journal_entries').selectAll()
      .where('id', '=', original.id).executeTakeFirstOrThrow();
    expect(after.status).toBe('posted');
  });

  it('hides a correction target belonging to another business', async () => {
    const { firm, biz, ctx, cash, revenue } = await setup(t);
    const otherBusiness = await makeBusiness(t.db, firm.id, 'Other Biz');
    await seedYearPeriods(t.db, otherBusiness.id, 2026);
    const otherCash = await makeAccount(t.db, otherBusiness.id, { code: '1110', name: 'Other Cash', account_type: 'asset' });
    const otherRevenue = await makeAccount(t.db, otherBusiness.id, { code: '4110', name: 'Other Sales', account_type: 'revenue' });
    const otherCtx = { ...ctx, business_id: otherBusiness.id };
    const otherEntry = await t.db.transaction().execute(trx =>
      ledger.postJournalEntry(trx, otherCtx, {
        business_id: otherBusiness.id,
        entry_date: '2026-04-15',
        source_type: 'manual',
        memo: null,
        lines: [
          { account_id: otherCash.id, debit: '60.0000', credit: '0.0000', memo: null },
          { account_id: otherRevenue.id, debit: '0.0000', credit: '60.0000', memo: null },
        ],
      }),
    );

    await expect(t.db.transaction().execute(trx =>
      ledger.correctJournalEntry(trx, ctx, {
        journal_entry_id: otherEntry.id,
        replacement: {
          business_id: biz.id,
          entry_date: '2026-04-16',
          source_type: 'manual',
          memo: null,
          lines: [
            { account_id: cash.id, debit: '65.0000', credit: '0.0000', memo: null },
            { account_id: revenue.id, debit: '0.0000', credit: '65.0000', memo: null },
          ],
        },
      }),
    )).rejects.toMatchObject({ code: ERR.NOT_FOUND });

    const after = await t.db.selectFrom('journal_entries').selectAll()
      .where('id', '=', otherEntry.id).executeTakeFirstOrThrow();
    expect(after.status).toBe('posted');
  });

  it('rejects correction in a closed original period without changing the ledger', async () => {
    const { biz, ctx, cash, revenue } = await setup(t);
    const original = await t.db.transaction().execute(trx =>
      ledger.postJournalEntry(trx, ctx, {
        business_id: biz.id,
        entry_date: '2026-04-15',
        source_type: 'manual',
        memo: null,
        lines: [
          { account_id: cash.id, debit: '70.0000', credit: '0.0000', memo: null },
          { account_id: revenue.id, debit: '0.0000', credit: '70.0000', memo: null },
        ],
      }),
    );
    const period = (await periods.findPeriodForDate(t.db, biz.id, '2026-04-15'))!;
    await t.db.transaction().execute(trx =>
      periods.closePeriod(trx, { ...ctx, effective_role: 'firm_admin' }, { period_id: period.id }),
    );

    await expect(t.db.transaction().execute(trx =>
      ledger.correctJournalEntry(trx, ctx, {
        journal_entry_id: original.id,
        replacement: {
          business_id: biz.id,
          entry_date: '2026-05-02',
          source_type: 'manual',
          memo: null,
          lines: [
            { account_id: cash.id, debit: '75.0000', credit: '0.0000', memo: null },
            { account_id: revenue.id, debit: '0.0000', credit: '75.0000', memo: null },
          ],
        },
      }),
    )).rejects.toMatchObject({ code: ERR.CLOSED_PERIOD });

    const entries = await t.db.selectFrom('journal_entries').selectAll()
      .where('business_id', '=', biz.id).execute();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.status).toBe('posted');
  });

  it('rolls back the void when replacement data is unbalanced', async () => {
    const { biz, ctx, cash, revenue } = await setup(t);
    const original = await t.db.transaction().execute(trx =>
      ledger.postJournalEntry(trx, ctx, {
        business_id: biz.id,
        entry_date: '2026-04-15',
        source_type: 'manual',
        memo: null,
        lines: [
          { account_id: cash.id, debit: '80.0000', credit: '0.0000', memo: null },
          { account_id: revenue.id, debit: '0.0000', credit: '80.0000', memo: null },
        ],
      }),
    );

    await expect(t.db.transaction().execute(trx =>
      ledger.correctJournalEntry(trx, ctx, {
        journal_entry_id: original.id,
        replacement: {
          business_id: biz.id,
          entry_date: '2026-04-16',
          source_type: 'manual',
          memo: null,
          lines: [
            { account_id: cash.id, debit: '85.0000', credit: '0.0000', memo: null },
            { account_id: revenue.id, debit: '0.0000', credit: '84.0000', memo: null },
          ],
        },
      }),
    )).rejects.toMatchObject({ code: ERR.UNBALANCED_ENTRY });

    const entries = await t.db.selectFrom('journal_entries').selectAll()
      .where('business_id', '=', biz.id).execute();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: original.id, status: 'posted' });
  });

  it('rejects a second correction of the same original', async () => {
    const { biz, ctx, cash, revenue } = await setup(t);
    const original = await t.db.transaction().execute(trx =>
      ledger.postJournalEntry(trx, ctx, {
        business_id: biz.id,
        entry_date: '2026-04-15',
        source_type: 'manual',
        memo: null,
        lines: [
          { account_id: cash.id, debit: '90.0000', credit: '0.0000', memo: null },
          { account_id: revenue.id, debit: '0.0000', credit: '90.0000', memo: null },
        ],
      }),
    );
    const replacement = {
      business_id: biz.id,
      entry_date: '2026-04-16',
      source_type: 'manual' as const,
      memo: null,
      lines: [
        { account_id: cash.id, debit: '95.0000', credit: '0.0000', memo: null },
        { account_id: revenue.id, debit: '0.0000', credit: '95.0000', memo: null },
      ],
    };

    await t.db.transaction().execute(trx => ledger.correctJournalEntry(trx, ctx, {
      journal_entry_id: original.id,
      replacement,
    }));
    await expect(t.db.transaction().execute(trx => ledger.correctJournalEntry(trx, ctx, {
      journal_entry_id: original.id,
      replacement,
    }))).rejects.toMatchObject({ code: ERR.INVALID_STATE_TRANSITION });

    const entries = await t.db.selectFrom('journal_entries').selectAll()
      .where('business_id', '=', biz.id).execute();
    expect(entries).toHaveLength(3);
  });

  it('computeAccountBalance sums debits minus credits across posted lines only', async () => {
    const { biz, ctx, cash, revenue } = await setup(t);
    await t.db.transaction().execute(trx =>
      ledger.postJournalEntry(trx, ctx, {
        business_id: biz.id, entry_date: '2026-04-15', source_type: 'manual', memo: null,
        lines: [
          { account_id: cash.id,    debit: '100.0000', credit: '0.0000',   memo: null },
          { account_id: revenue.id, debit: '0.0000',   credit: '100.0000', memo: null },
        ],
      }),
    );
    const cashBal = await ledger.computeAccountBalance(t.db, { account_id: cash.id, as_of: '2026-12-31' });
    expect(cashBal).toBe('100.0000');
    const revBal = await ledger.computeAccountBalance(t.db, { account_id: revenue.id, as_of: '2026-12-31' });
    expect(revBal).toBe('-100.0000');
  });

  it('void nets to zero in computeAccountBalance and computeTrialBalance (voided original + posted reversal)', async () => {
    const { biz, ctx, cash, revenue } = await setup(t);
    await t.db.transaction().execute(trx =>
      ledger.postJournalEntry(trx, ctx, {
        business_id: biz.id, entry_date: '2026-04-10', source_type: 'manual', memo: 'kept',
        lines: [
          { account_id: cash.id,    debit: '100.0000', credit: '0.0000',   memo: null },
          { account_id: revenue.id, debit: '0.0000',   credit: '100.0000', memo: null },
        ],
      }),
    );
    const je = await t.db.transaction().execute(trx =>
      ledger.postJournalEntry(trx, ctx, {
        business_id: biz.id, entry_date: '2026-04-15', source_type: 'manual', memo: 'voided later',
        lines: [
          { account_id: cash.id,    debit: '999.0000', credit: '0.0000',   memo: null },
          { account_id: revenue.id, debit: '0.0000',   credit: '999.0000', memo: null },
        ],
      }),
    );
    await t.db.transaction().execute(trx =>
      ledger.voidJournalEntry(trx, ctx, { journal_entry_id: je.id, void_reason: 'entered twice' }),
    );

    // The void pair (voided original + posted reversal) must cancel exactly,
    // leaving only the kept entry. Counting just one leg flips the sign.
    const cashBal = await ledger.computeAccountBalance(t.db, { account_id: cash.id, as_of: '2026-12-31' });
    expect(cashBal).toBe('100.0000');

    const tb = await ledger.computeTrialBalance(t.db, { business_id: biz.id, as_of: '2026-12-31' });
    const cashRow = tb.rows.find(r => r.account_id === cash.id)!;
    expect(cashRow.net).toBe('100.0000');
    const revRow = tb.rows.find(r => r.account_id === revenue.id)!;
    expect(revRow.net).toBe('-100.0000');
  });
});
