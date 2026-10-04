import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeAccount, makeBankAccount, makeBusiness, makeFirm, makeUser, makeVendor, seedYearPeriods } from '../helpers/factories.js';
import {
  applyCheckStub,
  dismissCheckStub,
  listCheckStubs,
  matchStubsToLines,
  saveCheckStubs,
} from '../../src/services/ai/checkStubService.js';
import { postStatementLines, type StatementLine } from '../../src/services/ai/statementImportService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

async function setup(t: TestDb) {
  const firm = await makeFirm(t.db);
  const business = await makeBusiness(t.db, firm.id, 'Check Stub Biz');
  const user = await makeUser(t.db, firm.id, { role: 'accountant' });
  const ctx: ServiceCtx = {
    user_id: user.id, firm_id: firm.id, business_id: business.id, effective_role: 'accountant',
    request_id: '00000000-0000-0000-0000-00000000ab16', ip_address: '127.0.0.1', user_agent: 'vitest',
  };
  await seedYearPeriods(t.db, business.id, 2026);
  const checking = await makeAccount(t.db, business.id, { code: '1010', name: 'Operating Checking', account_type: 'asset' });
  await makeBankAccount(t.db, business.id, checking.id);
  const utilities = await makeAccount(t.db, business.id, { code: '6300', name: 'Utilities', account_type: 'expense' });
  const rent = await makeAccount(t.db, business.id, { code: '6400', name: 'Rent', account_type: 'expense' });
  const uncategorized = await makeAccount(t.db, business.id, { code: '6999', name: 'Uncategorized Expense', account_type: 'expense' });
  return { business, ctx, checking, utilities, rent, uncategorized };
}

async function saveStubs(t: TestDb, ctx: ServiceCtx) {
  return t.db.transaction().execute(trx => saveCheckStubs(trx, ctx, {
    checks: [
      { check_number: '1042', date: '03/02/2026', payee_name: 'Duke Energy', amount: '312.40', memo: 'March electric', suggested_account: 'Utilities' },
      { check_number: '1043', date: '03/03/2026', payee_name: 'Oak Street Properties', amount: '$2,500.00', memo: 'March rent', suggested_account: 'Rent' },
      { check_number: '1044', date: '03/10/2026', payee_name: 'Nobody', amount: '0' },
    ],
    source_file_id: null,
    source_filename: 'march-stubs.pdf',
  }));
}

describe('check stubs', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('saves stubs with clean numbers, amounts and a matched category', async () => {
    const data = await setup(t);
    const stubs = await saveStubs(t, data.ctx);
    expect(stubs).toHaveLength(2); // the zero-amount check is dropped
    expect(stubs[0]).toMatchObject({
      check_number: '1042', check_date: '2026-03-02', payee_name: 'Duke Energy', amount: '312.40',
      suggested_account_id: data.utilities.id, status: 'unmatched',
    });
    expect(stubs[1]).toMatchObject({ amount: '2500.00', suggested_account_id: data.rent.id });
  });

  it('matches statement checks by number and amount, or by a unique amount', async () => {
    const data = await setup(t);
    await saveStubs(t, data.ctx);
    const matches = await matchStubsToLines(t.db, data.business.id, [
      { index: 0, check_number: '1042', amount: '312.40', date: '2026-03-05', is_check: true },
      { index: 1, check_number: '1043', amount: '2400.00', date: '2026-03-05', is_check: true }, // wrong amount
      { index: 2, check_number: null, amount: '2500.00', date: '2026-03-06', is_check: true },   // amount only
      { index: 3, check_number: null, amount: '312.40', date: '2026-03-06', is_check: false },   // not a check
    ]);
    expect(matches.get(0)?.payee_name).toBe('Duke Energy');
    expect(matches.has(1)).toBe(false);
    expect(matches.get(2)?.payee_name).toBe('Oak Street Properties');
    expect(matches.has(3)).toBe(false);
  });

  it('marks a stub used when the statement check posts, and never reuses it', async () => {
    const data = await setup(t);
    const [duke] = await saveStubs(t, data.ctx);
    const lines: StatementLine[] = [
      { date: '03/05/2026', description: 'CHECK 1042', amount: '312.40', type: 'check' },
    ];
    const post = () => t.db.transaction().execute(trx => postStatementLines(trx, data.ctx, {
      staging_id: randomUUID(), statement_kind: 'bank', lines, account_id: data.checking.id,
      items: [{ index: 0, offset_account_id: data.utilities.id, payee_name: 'Duke Energy', check_stub_id: duke!.id }],
    }));
    const [entryId] = await post();

    const stub = await t.db.selectFrom('check_stubs').selectAll().where('id', '=', duke!.id).executeTakeFirstOrThrow();
    expect(stub).toMatchObject({ status: 'matched', matched_journal_entry_id: entryId });
    const entry = await t.db.selectFrom('journal_entries').select(['reference', 'payee_name']).where('id', '=', entryId!).executeTakeFirstOrThrow();
    expect(entry).toEqual({ reference: '1042', payee_name: 'Duke Energy' });

    await expect(post()).rejects.toThrow(/already been used/);
  });

  it('fills in a check that was already posted without its stub', async () => {
    const data = await setup(t);
    const vendor = await makeVendor(t.db, data.business.id, { name: 'Oak Street Properties' });
    // The statement was approved before the stubs arrived: check 1043 went to Uncategorized.
    const [entryId] = await t.db.transaction().execute(trx => postStatementLines(trx, data.ctx, {
      staging_id: randomUUID(), statement_kind: 'bank',
      lines: [{ date: '03/06/2026', description: 'CHECK 1043', amount: '2500.00', type: 'check' }],
      account_id: data.checking.id,
      items: [{ index: 0, offset_account_id: data.uncategorized.id }],
    }));
    await saveStubs(t, data.ctx);

    const listed = await listCheckStubs(t.db, data.ctx);
    const rent = listed.find(s => s.check_number === '1043')!;
    expect(rent.posted_check).toMatchObject({ kind: 'expense', journal_entry_id: entryId });
    expect(listed.find(s => s.check_number === '1042')!.posted_check).toBeNull();

    const applied = await t.db.transaction().execute(trx => applyCheckStub(trx, data.ctx, { stub_id: rent.id }));
    const expense = await t.db.selectFrom('expense_transactions').selectAll()
      .where('id', '=', rent.posted_check!.id).executeTakeFirstOrThrow();
    expect(expense).toMatchObject({ vendor_id: vendor.id, reference: '1043', memo: 'March rent', journal_entry_id: applied.journal_entry_id });
    const line = await t.db.selectFrom('expense_transaction_lines').selectAll()
      .where('expense_transaction_id', '=', expense.id).executeTakeFirstOrThrow();
    expect(line.category_account_id).toBe(data.rent.id);

    const after = await listCheckStubs(t.db, data.ctx);
    expect(after.find(s => s.id === rent.id)).toMatchObject({ status: 'matched', matched_journal_entry_id: applied.journal_entry_id });
  });

  it('dismisses a stub and keeps businesses apart', async () => {
    const data = await setup(t);
    const [duke] = await saveStubs(t, data.ctx);
    await t.db.transaction().execute(trx => dismissCheckStub(trx, data.ctx, duke!.id));
    expect((await listCheckStubs(t.db, data.ctx)).find(s => s.id === duke!.id)?.status).toBe('dismissed');

    const other = await setup(t);
    expect(await listCheckStubs(t.db, other.ctx)).toEqual([]);
    await expect(t.db.transaction().execute(trx => dismissCheckStub(trx, other.ctx, duke!.id)))
      .rejects.toThrow(/not found/i);
  });
});
