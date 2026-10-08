import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeAccount } from '../helpers/factories.js';
import * as cust from '../../src/services/ar/customerService.js';
import { ERR } from '@accounting/shared';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-0000000cdd02', ip_address: '127.0.0.1', user_agent: 'vitest' };

describe('customerService', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  async function setup() {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    return { firm, biz, ctx };
  }

  it('creates and lists customers, scoped to business', async () => {
    const { biz, ctx } = await setup();
    const c = await t.db.transaction().execute(trx =>
      cust.createCustomer(trx, ctx, { business_id: biz.id, name: 'Acme', email: 'acme@x.com' }),
    );
    expect(c.name).toBe('Acme');
    const list = await cust.listCustomers(t.db, biz.id);
    expect(list).toHaveLength(1);
  });

  it('rejects duplicate name', async () => {
    const { biz, ctx } = await setup();
    await t.db.transaction().execute(trx => cust.createCustomer(trx, ctx, { business_id: biz.id, name: 'Acme' }));
    await expect(
      t.db.transaction().execute(trx => cust.createCustomer(trx, ctx, { business_id: biz.id, name: 'Acme' })),
    ).rejects.toMatchObject({ code: ERR.DUPLICATE_RESOURCE });
  });

  it('soft-deletes a customer; list excludes by default', async () => {
    const { biz, ctx } = await setup();
    const c = await t.db.transaction().execute(trx => cust.createCustomer(trx, ctx, { business_id: biz.id, name: 'Acme' }));
    await t.db.transaction().execute(trx => cust.deleteCustomer(trx, ctx, { customer_id: c.id }));
    const list = await cust.listCustomers(t.db, biz.id);
    expect(list).toHaveLength(0);
  });

  it('hides an inactive customer unless asked, and brings them back when made active', async () => {
    const { biz, ctx } = await setup();
    const c = await t.db.transaction().execute(trx => cust.createCustomer(trx, ctx, { business_id: biz.id, name: 'Acme' }));
    await t.db.transaction().execute(trx => cust.updateCustomer(trx, ctx, { customer_id: c.id, patch: { is_active: false } }));
    expect(await cust.listCustomers(t.db, biz.id)).toHaveLength(0);
    expect(await cust.listCustomers(t.db, biz.id, { includeInactive: true })).toHaveLength(1);
    await t.db.transaction().execute(trx => cust.updateCustomer(trx, ctx, { customer_id: c.id, patch: { is_active: true } }));
    expect(await cust.listCustomers(t.db, biz.id)).toHaveLength(1);
  });

  it('refuses to delete a customer with a transaction, even a voided one', async () => {
    const { biz, ctx } = await setup();
    const c = await t.db.transaction().execute(trx => cust.createCustomer(trx, ctx, { business_id: biz.id, name: 'Acme' }));
    const ar = await makeAccount(t.db, biz.id, { name: 'Accounts Receivable', account_type: 'asset' });
    await t.db.insertInto('invoices').values({
      business_id: biz.id, customer_id: c.id, invoice_number: 'INV-1', issue_date: '2026-04-01', due_date: '2026-05-01',
      status: 'voided', subtotal: '10.00', total: '10.00', ar_account_id: ar.id,
    }).execute();
    expect((await cust.customerIdsWithTransactions(t.db, biz.id)).has(c.id)).toBe(true);
    await expect(
      t.db.transaction().execute(trx => cust.deleteCustomer(trx, ctx, { customer_id: c.id })),
    ).rejects.toMatchObject({ code: ERR.PRECONDITION_FAILED });
  });
});
