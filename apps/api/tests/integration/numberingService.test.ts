import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { startTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness } from '../helpers/factories.js';
import { nextNumber } from '../../src/services/core/numberingService.js';

let t: TestDb;
beforeAll(async () => { t = await startTestDb(); });
beforeEach(async () => { await truncateAll(t.db); });

describe('numberingService.nextNumber', () => {
  it('returns sequential zero-padded numbers for one business', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const n1 = await t.db.transaction().execute(trx => nextNumber(trx, biz.id, 'invoice', 'INV'));
    const n2 = await t.db.transaction().execute(trx => nextNumber(trx, biz.id, 'invoice', 'INV'));
    expect(n1).toBe('INV-0001');
    expect(n2).toBe('INV-0002');
  });

  it('keeps counters independent across businesses and entity types', async () => {
    const firm = await makeFirm(t.db);
    const a = await makeBusiness(t.db, firm.id, 'Biz A');
    const b = await makeBusiness(t.db, firm.id, 'Biz B');
    await t.db.transaction().execute(trx => nextNumber(trx, a.id, 'invoice', 'INV'));
    const secondInvoiceA = await t.db.transaction().execute(trx => nextNumber(trx, a.id, 'invoice', 'INV'));
    const firstBillA = await t.db.transaction().execute(trx => nextNumber(trx, a.id, 'bill', 'BILL'));
    const firstInvoiceB = await t.db.transaction().execute(trx => nextNumber(trx, b.id, 'invoice', 'INV'));
    expect(secondInvoiceA).toBe('INV-0002');
    expect(firstBillA).toBe('BILL-0001');
    expect(firstInvoiceB).toBe('INV-0001');
  });

  it('continues from a pre-seeded counter value', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    await t.db.insertInto('numbering_counters')
      .values({ business_id: biz.id, entity_type: 'sales_order', last_value: 7 })
      .execute();
    const n = await t.db.transaction().execute(trx => nextNumber(trx, biz.id, 'sales_order', 'SO'));
    expect(n).toBe('SO-0008');
  });

  it('serializes concurrent increments without duplicates', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const results = await Promise.all(Array.from({ length: 5 }, () =>
      t.db.transaction().execute(trx => nextNumber(trx, biz.id, 'purchase_order', 'PO')),
    ));
    expect(new Set(results).size).toBe(5);
    expect([...results].sort().at(-1)).toBe('PO-0005');
  });
});
