import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser } from '../helpers/factories.js';
import { record as auditRecord } from '../../src/services/audit/auditService.js';
import { activityFacets, listActivity } from '../../src/services/audit/activityLogService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-00000000ac71', ip_address: '127.0.0.1', user_agent: 'vitest' };

// Role audit 2026-10-08: everything was recorded, and could only be read one record at a time.
describe('activity log', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  async function setup() {
    const firm = await makeFirm(t.db);
    const green = await makeBusiness(t.db, firm.id, 'Green');
    const blue = await makeBusiness(t.db, firm.id, 'Blue');
    const pat = await makeUser(t.db, firm.id, { full_name: 'Pat Accountant', role: 'accountant' });
    const sam = await makeUser(t.db, firm.id, { full_name: 'Sam Staff', role: 'staff' });
    const ctx = (user: { id: string }, business_id: string | null): ServiceCtx =>
      ({ user_id: user.id, firm_id: firm.id, business_id, effective_role: 'accountant', ...meta });
    // One at a time, so each has its own moment and the order is certain.
    const log = async (c: ServiceCtx, action: string, entity_type: string, after: unknown) => {
      await t.db.transaction().execute(trx => auditRecord(trx, c, { action, entity_type, entity_id: null, before: null, after }));
      await new Promise(resolve => setTimeout(resolve, 5));
    };
    await log(ctx(pat, green.id), 'invoice.create', 'invoice', { invoice_number: 'INV-1' });
    await log(ctx(sam, green.id), 'expense.create', 'expense_transaction', { payee_text: 'Staples' });
    await log(ctx(pat, green.id), 'invoice.post', 'invoice', { invoice_number: 'INV-1' });
    await log(ctx(pat, blue.id), 'bill.create', 'bill', { bill_number: 'B-9' });
    await log(ctx(pat, null), 'auth.login', 'user', { email: 'pat@x.com' });
    return { firm, green, blue, pat, sam };
  }

  it('lists one company, newest first, and keeps the others and the firm out of it', async () => {
    const s = await setup();
    const { rows, has_more } = await listActivity(t.db, { firm_id: s.firm.id, business_id: s.green.id, limit: 50 });
    expect(has_more).toBe(false);
    expect(rows.map(r => [r.action, r.user_name])).toEqual([
      ['invoice.post', 'Pat Accountant'],
      ['expense.create', 'Sam Staff'],
      ['invoice.create', 'Pat Accountant'],
    ]);
    expect(rows[0]!.after).toEqual({ invoice_number: 'INV-1' });

    // What belongs to no company is the firm's own log.
    const firmLog = await listActivity(t.db, { firm_id: s.firm.id, business_id: null, limit: 50 });
    expect(firmLog.rows.map(r => r.action)).toEqual(['auth.login']);
  });

  it('pages, and narrows to a person or a kind of record', async () => {
    const s = await setup();
    const scope = { firm_id: s.firm.id, business_id: s.green.id };
    const first = await listActivity(t.db, { ...scope, limit: 2 });
    expect(first.rows).toHaveLength(2);
    expect(first.has_more).toBe(true);
    const second = await listActivity(t.db, { ...scope, limit: 2, before: first.rows[1]!.created_at });
    expect(second.rows.map(r => r.action)).toEqual(['invoice.create']);
    expect(second.has_more).toBe(false);

    expect((await listActivity(t.db, { ...scope, limit: 50, user_id: s.sam.id })).rows.map(r => r.action)).toEqual(['expense.create']);
    expect((await listActivity(t.db, { ...scope, limit: 50, entity_type: 'invoice' })).rows).toHaveLength(2);

    expect(await activityFacets(t.db, scope)).toEqual({
      users: [{ id: s.pat.id, name: 'Pat Accountant' }, { id: s.sam.id, name: 'Sam Staff' }],
      entity_types: ['expense_transaction', 'invoice'],
    });
  });
});
