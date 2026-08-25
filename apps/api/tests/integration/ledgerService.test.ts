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
