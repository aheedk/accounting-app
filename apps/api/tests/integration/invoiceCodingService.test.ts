import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeAccount, makeVendor, seedYearPeriods } from '../helpers/factories.js';
import * as invoiceCoding from '../../src/services/ai/invoiceCodingService.js';
import * as autoCoding from '../../src/services/ai/autoCodingService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = {
  request_id: '00000000-0000-0000-0000-0000000000ad',
  ip_address: '127.0.0.1',
  user_agent: 'vitest',
};

const VENDOR = 'Acme Office Supply';

async function setup(t: TestDb) {
  const firm = await makeFirm(t.db);
  const biz = await makeBusiness(t.db, firm.id, 'Invoice Biz');
  const user = await makeUser(t.db, firm.id, { role: 'accountant' });
  const ctx: ServiceCtx = {
    user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta,
  };
  await seedYearPeriods(t.db, biz.id, 2026);

  const office = await makeAccount(t.db, biz.id, { code: '6400', name: 'Office Supplies', account_type: 'expense' });
  const shipping = await makeAccount(t.db, biz.id, { code: '6500', name: 'Shipping and Delivery', account_type: 'expense' });
  const repairs = await makeAccount(t.db, biz.id, { code: '6600', name: 'Repairs and Maintenance', account_type: 'expense' });
  const furniture = await makeAccount(t.db, biz.id, { code: '1500', name: 'Furniture and Fixtures', account_type: 'asset' });
  const computers = await makeAccount(t.db, biz.id, { code: '1510', name: 'Computer Equipment', account_type: 'asset' });
  const vendor = await makeVendor(t.db, biz.id, { name: VENDOR });

  return { biz, ctx, office, shipping, repairs, furniture, computers, vendor };
}

describe('invoiceCodingService', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('codes each line of one bill differently instead of by vendor alone', async () => {
    const { ctx, office, furniture, shipping } = await setup(t);

    const results = await invoiceCoding.suggestInvoiceLines(t.db, ctx, VENDOR, [
      { description: 'Copy paper, 10 cases', amount: '420.0000', ai_suggested_account: 'Office Supplies' },
      { description: 'Standing desk', amount: '2750.0000', ai_suggested_account: 'Office Supplies' },
      { description: 'Delivery', amount: '65.0000', ai_suggested_account: 'Shipping and Delivery' },
    ]);

    expect(results[0]!.lines[0]!.account_id).toBe(office.id);
    // The model said Office Supplies; the capitalization rule overrides it.
    expect(results[1]).toMatchObject({ source_layer: 'accounting_rule', confidence: 96 });
    expect(results[1]!.lines[0]!.account_id).toBe(furniture.id);
    expect(results[2]!.lines[0]!.account_id).toBe(shipping.id);
  });

  it('capitalizes to the fixed-asset account that fits the item', async () => {
    const { ctx, computers, furniture } = await setup(t);

    const results = await invoiceCoding.suggestInvoiceLines(t.db, ctx, VENDOR, [
      { description: 'Dell rack server', amount: '6200.0000' },
      { description: 'Conference table', amount: '3100.0000' },
    ]);

    expect(results[0]!.lines[0]!.account_id).toBe(computers.id);
    expect(results[1]!.lines[0]!.account_id).toBe(furniture.id);
  });

  it('leaves a below-threshold item and a service to the other layers', async () => {
    const { ctx, office, repairs } = await setup(t);

    const results = await invoiceCoding.suggestInvoiceLines(t.db, ctx, VENDOR, [
      // Same item, under the threshold: not capitalized.
      { description: 'Standing desk', amount: '900.0000', ai_suggested_account: 'Office Supplies' },
      // A repair is an expense however large.
      { description: 'HVAC repair', amount: '8000.0000', ai_suggested_account: 'Repairs and Maintenance' },
    ]);

    expect(results[0]).toMatchObject({ source_layer: 'ai' });
    expect(results[0]!.lines[0]!.account_id).toBe(office.id);
    expect(results[1]).toMatchObject({ source_layer: 'ai' });
    expect(results[1]!.lines[0]!.account_id).toBe(repairs.id);
  });

  it('honours a per-business capitalization threshold', async () => {
    const { ctx, furniture, office } = await setup(t);
    await t.db.updateTable('businesses')
      .set({ capitalization_threshold: '500' })
      .where('id', '=', ctx.business_id!).execute();

    const [low] = await invoiceCoding.suggestInvoiceLines(t.db, ctx, VENDOR, [
      { description: 'Office chair', amount: '900.0000', ai_suggested_account: 'Office Supplies' },
    ]);
    expect(low!.lines[0]!.account_id).toBe(furniture.id);
    expect(low!.lines[0]!.account_id).not.toBe(office.id);
  });

  it('prefers a learned per-line rule over capitalization and the model', async () => {
    const { ctx, repairs, furniture } = await setup(t);

    await t.db.transaction().execute(trx => invoiceCoding.rememberInvoiceLineCoding(trx, ctx, {
      vendor_name: VENDOR,
      description: 'Standing desk',
      account_id: repairs.id,
      amount: '2750.0000',
      was_correction: true,
    }));

    const [result] = await invoiceCoding.suggestInvoiceLines(t.db, ctx, VENDOR, [
      { description: 'Standing desk - 2 each', amount: '5500.0000', ai_suggested_account: 'Office Supplies' },
    ]);

    expect(result).toMatchObject({ source_layer: 'learned_rule', confidence: 99 });
    expect(result!.lines[0]!.account_id).toBe(repairs.id);
    expect(result!.lines[0]!.account_id).not.toBe(furniture.id);
    // The amount comes from this line, not the stored template.
    expect(result!.lines[0]!.debit).toBe('5500.0000');
  });

  it('keeps separate learned rules for separate lines of the same vendor', async () => {
    const { ctx, office, shipping } = await setup(t);
    const remember = (description: string, accountId: string) =>
      t.db.transaction().execute(trx => invoiceCoding.rememberInvoiceLineCoding(trx, ctx, {
        vendor_name: VENDOR, description, account_id: accountId,
        amount: '10.0000', was_correction: true,
      }));

    await remember('Copy paper, 10 cases', office.id);
    await remember('Delivery', shipping.id);

    const rows = await t.db.selectFrom('account_coding_memory').selectAll()
      .where('business_id', '=', ctx.business_id!).execute();
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.line_key).sort()).toEqual(['copy paper', 'delivery']);

    const results = await invoiceCoding.suggestInvoiceLines(t.db, ctx, VENDOR, [
      { description: 'Copy paper - 4 cases', amount: '180.0000' },
      { description: 'Delivery', amount: '65.0000' },
    ]);
    expect(results[0]!.lines[0]!.account_id).toBe(office.id);
    expect(results[1]!.lines[0]!.account_id).toBe(shipping.id);
  });

  it('does not collide with a bank-transaction rule for the same vendor', async () => {
    const { ctx, office, repairs } = await setup(t);

    // A whole-transaction rule for the same vendor, written through the real
    // bank-side path so both upserts are exercised against the shared indexes.
    await t.db.transaction().execute(trx => autoCoding.rememberCoding(trx, ctx, {
      description: VENDOR,
      direction: 'debit',
      bank_account_id: null,
      lines: [{ account_id: repairs.id, debit: '500.0000', credit: '0.0000', memo: null }],
      was_correction: true,
    }));

    await t.db.transaction().execute(trx => invoiceCoding.rememberInvoiceLineCoding(trx, ctx, {
      vendor_name: VENDOR, description: 'Copy paper', account_id: office.id,
      amount: '100.0000', was_correction: true,
    }));

    const rows = await t.db.selectFrom('account_coding_memory').selectAll()
      .where('business_id', '=', ctx.business_id!).execute();
    expect(rows).toHaveLength(2);

    // The invoice line resolves from its own rule, not the bank one.
    const [result] = await invoiceCoding.suggestInvoiceLines(t.db, ctx, VENDOR, [
      { description: 'Copy paper', amount: '100.0000' },
    ]);
    expect(result!.lines[0]!.account_id).toBe(office.id);
  });

  it('uses the vendor default account when nothing more specific applies', async () => {
    const { ctx, vendor, office } = await setup(t);
    await t.db.updateTable('vendors')
      .set({ default_expense_account_id: office.id })
      .where('id', '=', vendor.id).execute();

    const [result] = await invoiceCoding.suggestInvoiceLines(t.db, ctx, VENDOR, [
      { description: 'Miscellaneous consumables', amount: '55.0000' },
    ]);
    expect(result).toMatchObject({ source_layer: 'vendor_default', confidence: 90 });
    expect(result!.lines[0]!.account_id).toBe(office.id);
  });

  it('discards an account the model invented', async () => {
    const { ctx } = await setup(t);
    const [result] = await invoiceCoding.suggestInvoiceLines(t.db, ctx, VENDOR, [
      { description: 'Mystery item', amount: '40.0000', ai_suggested_account: 'Imaginary Expenses' },
    ]);
    expect(result).toBeNull();
  });

  it('returns null when nothing can classify the line', async () => {
    const { ctx } = await setup(t);
    const [result] = await invoiceCoding.suggestInvoiceLines(t.db, ctx, VENDOR, [
      { description: 'Mystery item', amount: '40.0000' },
    ]);
    expect(result).toBeNull();
  });
});
