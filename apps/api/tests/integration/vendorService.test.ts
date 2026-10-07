import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeVendor, seedCoa, seedYearPeriods } from '../helpers/factories.js';
import * as vend from '../../src/services/ap/vendorService.js';
import * as expenses from '../../src/services/ap/expenseTransactionService.js';
import * as billSvc from '../../src/services/ap/billService.js';
import { AUDIT, ERR } from '@accounting/shared';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-0000000bbb10', ip_address: '127.0.0.1', user_agent: 'vitest' };

describe('vendorService', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await startTestDb();
    process.env['FIELD_ENCRYPTION_KEY'] =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  async function setup() {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    return { firm, biz, ctx };
  }

  async function setupWithCoa() {
    const base = await setup();
    await seedCoa(t.db, base.biz.id);
    await seedYearPeriods(t.db, base.biz.id, 2026);
    const ap = await t.db.selectFrom('chart_of_accounts').selectAll()
      .where('business_id', '=', base.biz.id).where('code', '=', '2010').executeTakeFirstOrThrow();
    const cash = await t.db.selectFrom('chart_of_accounts').selectAll()
      .where('business_id', '=', base.biz.id).where('code', '=', '1010').executeTakeFirstOrThrow();
    const expense = await t.db.selectFrom('chart_of_accounts').selectAll()
      .where('business_id', '=', base.biz.id).where('code', '=', '5010').executeTakeFirstOrThrow();
    return { ...base, ap, cash, expense };
  }

  it('creates and lists vendors, scoped to business, active by default', async () => {
    const { biz, ctx } = await setup();
    const v = await t.db.transaction().execute(trx =>
      vend.createVendor(trx, ctx, { business_id: biz.id, name: 'Acme Supply', email: 'ap@acme.com', is_1099: true, tax_id: '12-3456789', tax_id_type: 'EIN' }),
    );
    expect(v.name).toBe('Acme Supply');
    expect(v.is_1099).toBe(true);
    expect(v.is_active).toBe(true);
    expect(v.tax_id_last_four).toBe('6789');
    expect(v.tax_id_type).toBe('EIN');
    expect(v.tax_id_encrypted).toBeInstanceOf(Buffer);
    const list = await vend.listVendors(t.db, biz.id);
    expect(list).toHaveLength(1);
  });

  it('rejects duplicate name', async () => {
    const { biz, ctx } = await setup();
    await t.db.transaction().execute(trx => vend.createVendor(trx, ctx, { business_id: biz.id, name: 'Acme' }));
    await expect(
      t.db.transaction().execute(trx => vend.createVendor(trx, ctx, { business_id: biz.id, name: 'Acme' })),
    ).rejects.toMatchObject({ code: ERR.DUPLICATE_RESOURCE });
  });

  it('deletes a vendor with no transactions entirely -- not just soft-deleted', async () => {
    const { biz, ctx } = await setup();
    const v = await t.db.transaction().execute(trx => vend.createVendor(trx, ctx, { business_id: biz.id, name: 'Acme' }));
    await t.db.transaction().execute(trx => vend.deleteVendor(trx, ctx, { vendor_id: v.id }));
    const list = await vend.listVendors(t.db, biz.id);
    expect(list).toHaveLength(0);
    const row = await t.db.selectFrom('vendors').select('id').where('id', '=', v.id).executeTakeFirst();
    expect(row).toBeUndefined();
  });

  it('refuses to delete a vendor with an expense on file', async () => {
    const { biz, ctx, cash, expense } = await setupWithCoa();
    const vendor = await makeVendor(t.db, biz.id, { name: 'Staples' });
    await t.db.transaction().execute(trx => expenses.createExpense(trx, ctx, {
      transaction_date: '2026-04-15', vendor_id: vendor.id,
      payment_account_id: cash.id, payment_method: 'cash',
      lines: [{ category_account_id: expense.id, amount: '40.00' }],
    }));

    await expect(
      t.db.transaction().execute(trx => vend.deleteVendor(trx, ctx, { vendor_id: vendor.id })),
    ).rejects.toMatchObject({ code: ERR.PRECONDITION_FAILED });
    const stillThere = await t.db.selectFrom('vendors').select('id').where('id', '=', vendor.id).executeTakeFirst();
    expect(stillThere).toBeDefined();
  });

  it('refuses to delete a vendor with a bill on file, even just a draft', async () => {
    const { biz, ctx, expense } = await setupWithCoa();
    const vendor = await makeVendor(t.db, biz.id, { name: 'Office Supply Co' });
    await t.db.transaction().execute(trx => billSvc.createDraft(trx, ctx, {
      business_id: biz.id, vendor_id: vendor.id,
      bill_number: 'BILL-1', bill_date: '2026-04-15', due_date: '2026-05-15',
      memo: null, terms: null,
      lines: [{ description: 'Paper', quantity: '1', unit_price: '20.00', expense_account_id: expense.id }],
    }));

    await expect(
      t.db.transaction().execute(trx => vend.deleteVendor(trx, ctx, { vendor_id: vendor.id })),
    ).rejects.toMatchObject({ code: ERR.PRECONDITION_FAILED });
  });

  it('vendorIdsWithTransactions flags only vendors with a bill or expense on file', async () => {
    const { biz, ctx, cash, expense } = await setupWithCoa();
    const withBill = await makeVendor(t.db, biz.id, { name: 'Has Bill' });
    const withExpense = await makeVendor(t.db, biz.id, { name: 'Has Expense' });
    const clean = await makeVendor(t.db, biz.id, { name: 'No Transactions' });
    await t.db.transaction().execute(trx => billSvc.createDraft(trx, ctx, {
      business_id: biz.id, vendor_id: withBill.id,
      bill_number: 'BILL-2', bill_date: '2026-04-15', due_date: '2026-05-15',
      memo: null, terms: null,
      lines: [{ description: 'Paper', quantity: '1', unit_price: '20.00', expense_account_id: expense.id }],
    }));
    await t.db.transaction().execute(trx => expenses.createExpense(trx, ctx, {
      transaction_date: '2026-04-15', vendor_id: withExpense.id,
      payment_account_id: cash.id, payment_method: 'cash',
      lines: [{ category_account_id: expense.id, amount: '40.00' }],
    }));

    const flagged = await vend.vendorIdsWithTransactions(t.db, biz.id);
    expect(flagged.has(withBill.id)).toBe(true);
    expect(flagged.has(withExpense.id)).toBe(true);
    expect(flagged.has(clean.id)).toBe(false);
  });

  it('is_active: Make inactive hides a vendor from the default list but keeps it queryable', async () => {
    const { biz, ctx } = await setup();
    const v = await t.db.transaction().execute(trx => vend.createVendor(trx, ctx, { business_id: biz.id, name: 'Acme' }));

    const deactivated = await t.db.transaction().execute(trx =>
      vend.updateVendor(trx, ctx, { vendor_id: v.id, patch: { is_active: false } }));
    expect(deactivated.is_active).toBe(false);

    expect(await vend.listVendors(t.db, biz.id)).toHaveLength(0);
    expect(await vend.listVendors(t.db, biz.id, { includeInactive: true })).toHaveLength(1);

    const log = await t.db.selectFrom('audit_logs').selectAll()
      .where('entity_id', '=', v.id).where('action', '=', AUDIT.VENDOR_DEACTIVATE).executeTakeFirstOrThrow();
    expect(log.entity_id).toBe(v.id);

    const reactivated = await t.db.transaction().execute(trx =>
      vend.updateVendor(trx, ctx, { vendor_id: v.id, patch: { is_active: true } }));
    expect(reactivated.is_active).toBe(true);
    expect(await vend.listVendors(t.db, biz.id)).toHaveLength(1);
    await t.db.selectFrom('audit_logs').selectAll()
      .where('entity_id', '=', v.id).where('action', '=', AUDIT.VENDOR_REACTIVATE).executeTakeFirstOrThrow();
  });
});
