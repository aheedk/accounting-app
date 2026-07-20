import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeAccount, seedCoa, seedYearPeriods } from '../helpers/factories.js';
import * as coa from '../../src/services/core/chartOfAccountsService.js';
import * as ledger from '../../src/services/core/ledgerService.js';
import { ERR } from '@accounting/shared';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-000000000001', ip_address: '127.0.0.1', user_agent: 'vitest' };

async function setup(t: TestDb) {
  const firm = await makeFirm(t.db);
  const biz = await makeBusiness(t.db, firm.id, 'Biz');
  const user = await makeUser(t.db, firm.id, { role: 'firm_admin' });
  const ctx: ServiceCtx = {
    user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'firm_admin',
    ...meta,
  };
  return { firm, biz, user, ctx };
}

describe('chartOfAccountsService', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('seedDefaultCoa creates the standard COA + writes audit', async () => {
    const { biz, ctx } = await setup(t);
    await t.db.transaction().execute(trx => coa.seedDefaultCoa(trx, ctx, { business_id: biz.id }));
    const accounts = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).execute();
    expect(accounts.length).toBeGreaterThan(20);
    const ar = accounts.find(a => a.code === '1100');
    expect(ar?.is_system).toBe(true);
    const audits = await t.db.selectFrom('audit_logs').selectAll().execute();
    expect(audits.some(a => a.action === 'coa.create')).toBe(true);
  });

  it('createAccount creates a non-system account', async () => {
    const { biz, ctx } = await setup(t);
    const created = await t.db.transaction().execute(trx =>
      coa.createAccount(trx, ctx, { business_id: biz.id, code: '4500', name: 'Consulting', account_type: 'revenue', parent_id: null }),
    );
    expect(created.code).toBe('4500');
    expect(created.is_system).toBe(false);
  });

  it('createAccount: duplicate code rejected with DUPLICATE_RESOURCE', async () => {
    const { biz, ctx } = await setup(t);
    await t.db.transaction().execute(trx =>
      coa.createAccount(trx, ctx, { business_id: biz.id, code: '4500', name: 'Consulting', account_type: 'revenue', parent_id: null }),
    );
    await expect(
      t.db.transaction().execute(trx =>
        coa.createAccount(trx, ctx, { business_id: biz.id, code: '4500', name: 'Other', account_type: 'revenue', parent_id: null }),
      ),
    ).rejects.toMatchObject({ code: ERR.DUPLICATE_RESOURCE });
  });

  it('updateAccount on a system account: forbids name change but allows is_active toggle', async () => {
    const { biz, ctx } = await setup(t);
    await t.db.transaction().execute(trx => coa.seedDefaultCoa(trx, ctx, { business_id: biz.id }));
    const ar = await t.db.selectFrom('chart_of_accounts').selectAll().where('code', '=', '1100').executeTakeFirstOrThrow();
    await expect(
      t.db.transaction().execute(trx => coa.updateAccount(trx, ctx, { account_id: ar.id, patch: { name: 'NEW NAME' } })),
    ).rejects.toMatchObject({ code: ERR.PRECONDITION_FAILED });
    const after = await t.db.transaction().execute(trx =>
      coa.updateAccount(trx, ctx, { account_id: ar.id, patch: { is_active: false } }),
    );
    expect(after.is_active).toBe(false);
  });

  it('listAccounts respects business scoping', async () => {
    const { biz, ctx } = await setup(t);
    const otherBiz = await (async () => {
      const otherFirm = await makeFirm(t.db, 'Other Firm');
      return makeBusiness(t.db, otherFirm.id, 'OtherBiz');
    })();
    await t.db.transaction().execute(trx => coa.seedDefaultCoa(trx, ctx, { business_id: biz.id }));
    await t.db.transaction().execute(trx =>
      coa.seedDefaultCoa(trx, { ...ctx, business_id: otherBiz.id, firm_id: otherBiz.firm_id } as ServiceCtx, { business_id: otherBiz.id }),
    );
    const list = await coa.listAccounts(t.db, { business_id: biz.id });
    expect(list.every(a => a.business_id === biz.id)).toBe(true);
  });

  // ── Happy-path gaps not covered by existing tests ────────────────────────

  it('updateAccount: can reactivate a previously deactivated account', async () => {
    const { biz, ctx } = await setup(t);
    const account = await makeAccount(t.db, biz.id);
    await t.db.transaction().execute(trx =>
      coa.updateAccount(trx, ctx, { account_id: account.id, patch: { is_active: false } }),
    );
    const reactivated = await t.db.transaction().execute(trx =>
      coa.updateAccount(trx, ctx, { account_id: account.id, patch: { is_active: true } }),
    );
    expect(reactivated.is_active).toBe(true);
  });

  it('listAccounts: include_inactive=true returns deactivated accounts; default excludes them', async () => {
    const { biz, ctx } = await setup(t);
    const account = await makeAccount(t.db, biz.id, { code: 'X999' });
    await t.db.transaction().execute(trx =>
      coa.updateAccount(trx, ctx, { account_id: account.id, patch: { is_active: false } }),
    );
    const activeOnly = await coa.listAccounts(t.db, { business_id: biz.id });
    expect(activeOnly.some(a => a.id === account.id)).toBe(false);
    const withInactive = await coa.listAccounts(t.db, { business_id: biz.id, include_inactive: true });
    expect(withInactive.some(a => a.id === account.id)).toBe(true);
  });

  it('listAccounts: results are sorted by code ASC', async () => {
    const { biz, ctx } = await setup(t);
    for (const code of ['Z001', 'A001', 'M001']) {
      await t.db.transaction().execute(trx =>
        coa.createAccount(trx, ctx, { business_id: biz.id, code, name: code, account_type: 'asset', parent_id: null }),
      );
    }
    const list = await coa.listAccounts(t.db, { business_id: biz.id });
    const codes = list.map(a => a.code);
    expect(codes).toEqual([...codes].sort());
  });

  it('createAccount: same code in different businesses succeeds', async () => {
    const { biz, ctx } = await setup(t);
    const otherFirm = await makeFirm(t.db, 'Other Firm');
    const otherBiz = await makeBusiness(t.db, otherFirm.id, 'OtherBiz');
    const otherCtx: ServiceCtx = { ...ctx, business_id: otherBiz.id, firm_id: otherFirm.id };
    await t.db.transaction().execute(trx =>
      coa.createAccount(trx, ctx, { business_id: biz.id, code: '9000', name: 'Shared Code A', account_type: 'asset', parent_id: null }),
    );
    const second = await t.db.transaction().execute(trx =>
      coa.createAccount(trx, otherCtx, { business_id: otherBiz.id, code: '9000', name: 'Shared Code B', account_type: 'asset', parent_id: null }),
    );
    expect(second.code).toBe('9000');
  });

  it('createAccount: valid special characters in code (. - _)', async () => {
    const { biz, ctx } = await setup(t);
    for (const code of ['1000.1', '1000-A', '1000_B']) {
      const acc = await t.db.transaction().execute(trx =>
        coa.createAccount(trx, ctx, { business_id: biz.id, code, name: `Account ${code}`, account_type: 'asset', parent_id: null }),
      );
      expect(acc.code).toBe(code);
    }
  });

  it('updateAccount: self-referential parent_id rejected', async () => {
    const { biz, ctx } = await setup(t);
    const account = await makeAccount(t.db, biz.id);
    await expect(
      t.db.transaction().execute(trx =>
        coa.updateAccount(trx, ctx, { account_id: account.id, patch: { parent_id: account.id } }),
      ),
    ).rejects.toMatchObject({ code: ERR.PRECONDITION_FAILED });
  });

  it('getSystemAccount: returns the correct system account', async () => {
    const { biz, ctx } = await setup(t);
    await t.db.transaction().execute(trx => coa.seedDefaultCoa(trx, ctx, { business_id: biz.id }));
    const ar = await coa.getSystemAccount(t.db, biz.id, '1100');
    expect(ar.is_system).toBe(true);
    expect(ar.code).toBe('1100');
  });

  it('getSystemAccount: throws NOT_FOUND for an unknown code', async () => {
    const { biz } = await setup(t);
    await expect(coa.getSystemAccount(t.db, biz.id, '9999')).rejects.toMatchObject({ code: ERR.NOT_FOUND });
  });

  // ── QBO parity: account renumbering ──────────────────────────────────────

  it('updateAccount: renumbers a non-system account and writes audit', async () => {
    const { biz, ctx } = await setup(t);
    const account = await makeAccount(t.db, biz.id, { code: '1500' });
    const updated = await t.db.transaction().execute(trx =>
      coa.updateAccount(trx, ctx, { account_id: account.id, patch: { code: '1510' } }),
    );
    expect(updated.code).toBe('1510');
    const audits = await t.db.selectFrom('audit_logs').selectAll().where('action', '=', 'coa.update').execute();
    expect(audits.some(a => a.entity_id === account.id)).toBe(true);
  });

  it('updateAccount: duplicate code within business rejected with DUPLICATE_RESOURCE', async () => {
    const { biz, ctx } = await setup(t);
    await makeAccount(t.db, biz.id, { code: '1600' });
    const other = await makeAccount(t.db, biz.id, { code: '1601' });
    await expect(
      t.db.transaction().execute(trx =>
        coa.updateAccount(trx, ctx, { account_id: other.id, patch: { code: '1600' } }),
      ),
    ).rejects.toMatchObject({ code: ERR.DUPLICATE_RESOURCE });
  });

  it('updateAccount: system account code change rejected', async () => {
    const { biz, ctx } = await setup(t);
    await t.db.transaction().execute(trx => coa.seedDefaultCoa(trx, ctx, { business_id: biz.id }));
    const ar = await t.db.selectFrom('chart_of_accounts').selectAll()
      .where('business_id', '=', biz.id).where('code', '=', '1100').executeTakeFirstOrThrow();
    await expect(
      t.db.transaction().execute(trx =>
        coa.updateAccount(trx, ctx, { account_id: ar.id, patch: { code: '1199' } }),
      ),
    ).rejects.toMatchObject({ code: ERR.PRECONDITION_FAILED });
  });

  it('updateAccount: re-submitting the current code is a no-op success (no dup error)', async () => {
    const { biz, ctx } = await setup(t);
    const account = await makeAccount(t.db, biz.id, { code: '1700' });
    const updated = await t.db.transaction().execute(trx =>
      coa.updateAccount(trx, ctx, { account_id: account.id, patch: { code: '1700', name: 'Renamed' } }),
    );
    expect(updated.code).toBe('1700');
    expect(updated.name).toBe('Renamed');
  });

  // ── QBO parity: account register ─────────────────────────────────────────

  it('listAccountRegister: running balance in natural sign; void pair shown and nets to zero', async () => {
    const { biz, ctx } = await setup(t);
    await seedYearPeriods(t.db, biz.id, 2026);
    const cash = await makeAccount(t.db, biz.id, { code: '1001', account_type: 'asset' });
    const revenue = await makeAccount(t.db, biz.id, { code: '4001', account_type: 'revenue' });

    await t.db.transaction().execute(trx => ledger.postJournalEntry(trx, ctx, {
      business_id: biz.id, entry_date: '2026-01-10', source_type: 'manual', memo: 'Sale 1',
      lines: [
        { account_id: cash.id, debit: '100.0000', credit: '0.0000', memo: null },
        { account_id: revenue.id, debit: '0.0000', credit: '100.0000', memo: null },
      ],
    }));
    await t.db.transaction().execute(trx => ledger.postJournalEntry(trx, ctx, {
      business_id: biz.id, entry_date: '2026-01-15', source_type: 'manual', memo: 'Sale 2',
      lines: [
        { account_id: cash.id, debit: '50.0000', credit: '0.0000', memo: 'line memo wins' },
        { account_id: revenue.id, debit: '0.0000', credit: '50.0000', memo: null },
      ],
    }));
    const voided = await t.db.transaction().execute(trx => ledger.postJournalEntry(trx, ctx, {
      business_id: biz.id, entry_date: '2026-01-20', source_type: 'manual', memo: 'Oops',
      lines: [
        { account_id: cash.id, debit: '999.0000', credit: '0.0000', memo: null },
        { account_id: revenue.id, debit: '0.0000', credit: '999.0000', memo: null },
      ],
    }));
    await t.db.transaction().execute(trx =>
      ledger.voidJournalEntry(trx, ctx, { journal_entry_id: voided.id, void_reason: 'test' }),
    );

    // History keeps both legs of the void: the voided original AND its posted
    // reversal (dated today) — they cancel, so the ending balance is unchanged.
    const cashReg = await coa.listAccountRegister(t.db, { business_id: biz.id, account_id: cash.id });
    expect(cashReg.rows).toHaveLength(4);
    expect(cashReg.rows[0]!.balance).toBe('100.0000');
    expect(cashReg.rows[1]!.balance).toBe('150.0000');
    expect(cashReg.rows[1]!.memo).toBe('line memo wins');
    expect(cashReg.rows[2]!.is_voided).toBe(true);
    expect(cashReg.rows[3]!.source_type).toBe('reversal');
    expect(cashReg.ending_balance).toBe('150.0000');

    // Credit-normal account: revenue balance also runs positive and ends at 150.
    const revReg = await coa.listAccountRegister(t.db, { business_id: biz.id, account_id: revenue.id });
    expect(revReg.rows).toHaveLength(4);
    expect(revReg.ending_balance).toBe('150.0000');
  });

  it('listAccountRegister: account in another business → NOT_FOUND', async () => {
    const { biz } = await setup(t);
    const otherFirm = await makeFirm(t.db, 'Other Firm');
    const otherBiz = await makeBusiness(t.db, otherFirm.id, 'OtherBiz');
    const foreign = await makeAccount(t.db, otherBiz.id, { code: '1001' });
    await expect(
      coa.listAccountRegister(t.db, { business_id: biz.id, account_id: foreign.id }),
    ).rejects.toMatchObject({ code: ERR.NOT_FOUND });
  });

  // ── Gap probes — these tests assert the CORRECT future behavior.
  //    They use it.fails() so the suite stays green while the gap exists.
  //    When a gap is fixed, that it.fails() will start FAILING — your signal
  //    to remove the it.fails() wrapper and keep it as a regular passing test.
  // ────────────────────────────────────────────────────────────────────────

  // GAP-2: No parent-child cycle detection. A is parent of B → patching A's
  // parent to B creates A→B→A. Should throw but currently resolves.
  it.fails('GAP-2: updateAccount should reject a parent-child cycle (A→B→A)', async () => {
    const { biz, ctx } = await setup(t);
    const a = await makeAccount(t.db, biz.id, { code: 'C100', account_type: 'asset' });
    const b = await t.db.transaction().execute(trx =>
      coa.createAccount(trx, ctx, { business_id: biz.id, code: 'C200', name: 'Child', account_type: 'asset', parent_id: a.id }),
    );
    await expect(
      t.db.transaction().execute(trx =>
        coa.updateAccount(trx, ctx, { account_id: a.id, patch: { parent_id: b.id } }),
      ),
    ).rejects.toThrow();
  });

  // GAP-3: No cross-type parent validation. An asset account should not be
  // allowed to parent an equity account, but currently it can.
  it.fails('GAP-3: createAccount should reject a parent whose account_type differs from child', async () => {
    const { biz, ctx } = await setup(t);
    const equity = await makeAccount(t.db, biz.id, { code: 'E100', account_type: 'equity' });
    await expect(
      t.db.transaction().execute(trx =>
        coa.createAccount(trx, ctx, {
          business_id: biz.id, code: 'A100', name: 'Asset under Equity', account_type: 'asset', parent_id: equity.id,
        }),
      ),
    ).rejects.toThrow();
  });

  // GAP-4 (HIGH): No guard on deactivating accounts with journal entries.
  // Deactivating such an account makes its historical JEs unclassifiable in
  // reports. Should throw PRECONDITION_FAILED but currently returns the row.
  it.fails('GAP-4: updateAccount should reject deactivating an account that has journal entries', async () => {
    const { biz, ctx } = await setup(t);
    await seedCoa(t.db, biz.id);
    const year = new Date().getUTCFullYear();
    await seedYearPeriods(t.db, biz.id, year);

    const cash = await t.db.selectFrom('chart_of_accounts').selectAll()
      .where('business_id', '=', biz.id).where('code', '=', '1010').executeTakeFirstOrThrow();
    const expense = await t.db.selectFrom('chart_of_accounts').selectAll()
      .where('business_id', '=', biz.id).where('code', '=', '5010').executeTakeFirstOrThrow();

    await t.db.transaction().execute(trx =>
      ledger.postJournalEntry(trx, ctx, {
        business_id: biz.id,
        entry_date: new Date().toISOString().slice(0, 10),
        source_type: 'manual',
        memo: 'gap-4 probe',
        lines: [
          { account_id: expense.id, debit: '100', credit: '0', memo: null },
          { account_id: cash.id, debit: '0', credit: '100', memo: null },
        ],
      }),
    );

    await expect(
      t.db.transaction().execute(trx =>
        coa.updateAccount(trx, ctx, { account_id: expense.id, patch: { is_active: false } }),
      ),
    ).rejects.toMatchObject({ code: ERR.PRECONDITION_FAILED });
  });
});
