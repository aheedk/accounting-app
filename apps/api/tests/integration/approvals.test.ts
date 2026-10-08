// The approval step, through the HTTP layer: what staff enter waits for an
// accountant when the company asks for that (role audit 2026-10-08).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, grantAccess, makeAccount, seedCoa, seedYearPeriods } from '../helpers/factories.js';
import { makeApp } from '../../src/app.js';
import { destroyDbSingleton } from '../../src/db/index.js';
import { findHeldAction } from '../../src/services/core/approvalService.js';

const PASSWORD = 'pw12345678';
const year = new Date().getUTCFullYear();

describe('approval step', () => {
  let t: TestDb;
  let app: Express;
  let bizId: string;
  let cashId: string;
  let suppliesId: string;

  beforeAll(async () => {
    t = await startTestDb();
    process.env.DATABASE_URL = t.url;
    app = makeApp();
  });
  afterAll(async () => {
    await destroyDbSingleton();
    await stopTestDb();
  });
  beforeEach(async () => {
    await truncateAll(t.db);
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id, 'Approval Co');
    bizId = biz.id;
    await seedCoa(t.db, biz.id);
    await seedYearPeriods(t.db, biz.id, year);
    cashId = (await makeAccount(t.db, biz.id, { code: '1099', name: 'Petty Cash', account_type: 'asset' })).id;
    suppliesId = (await makeAccount(t.db, biz.id, { code: '6199', name: 'Supplies', account_type: 'expense' })).id;
    await makeUser(t.db, firm.id, { email: 'admin@x.com', password: PASSWORD, role: 'firm_admin' });
    for (const role of ['accountant', 'staff'] as const) {
      const user = await makeUser(t.db, firm.id, { email: `${role}@x.com`, password: PASSWORD, role });
      await grantAccess(t.db, user.id, biz.id);
    }
  });

  async function signIn(email: string) {
    const res = await request(app).post('/auth/login').send({ email, password: PASSWORD });
    const token = res.body.access_token as string;
    return {
      get: (url: string) => request(app).get(`/businesses/${bizId}${url}`).set('Authorization', `Bearer ${token}`),
      post: (url: string, body: object = {}) => request(app).post(`/businesses/${bizId}${url}`).set('Authorization', `Bearer ${token}`).send(body),
      patch: (url: string, body: object) => request(app).patch(`/businesses/${bizId}${url}`).set('Authorization', `Bearer ${token}`).send(body),
    };
  }
  const expense = (payee: string, amount: string, date = `${year}-06-15`) => ({
    transaction_date: date, payee_text: payee, payment_account_id: cashId, payment_method: 'cash',
    lines: [{ category_account_id: suppliesId, amount }],
  });
  const expenseCount = async () => (await t.db.selectFrom('expense_transactions').select('id').where('business_id', '=', bizId).execute()).length;

  it('knows which requests are the ones that post at once', () => {
    expect(findHeldAction('POST', '/expense-transactions')?.held.action).toBe('expense.create');
    expect(findHeldAction('PATCH', '/checks/00000000-0000-0000-0000-000000000000')).toMatchObject({ record_id: '00000000-0000-0000-0000-000000000000' });
    expect(findHeldAction('POST', '/bank-transactions/00000000-0000-0000-0000-000000000000/categorize')?.held.action).toBe('bank_transaction.categorize');
    // Drafts and master records are not held: an accountant posts those anyway.
    expect(findHeldAction('POST', '/invoices')).toBeNull();
    expect(findHeldAction('POST', '/customers')).toBeNull();
    expect(findHeldAction('GET', '/expense-transactions')).toBeNull();
  });

  it('leaves a company alone until approval is switched on, then holds what staff save', async () => {
    const admin = await signIn('admin@x.com');
    const staff = await signIn('staff@x.com');
    const accountant = await signIn('accountant@x.com');

    // Off: staff save and it is recorded, as always.
    expect((await staff.post('/expense-transactions', expense('Staples', '20.00'))).status).toBe(201);
    expect(await expenseCount()).toBe(1);

    expect((await admin.patch('', { staff_entries_need_approval: true })).status).toBe(200);

    // On: it waits. Nothing is recorded.
    const held = await staff.post('/expense-transactions', expense('Staples', '45.00'));
    expect(held.status).toBe(202);
    expect(held.body).toMatchObject({ pending_approval: true });
    expect(await expenseCount()).toBe(1);
    // A mistake is caught when saved, not when approved, and is not queued.
    expect((await staff.post('/expense-transactions', { ...expense('Staples', '1.00'), lines: [] })).status).toBe(400);

    // An accountant is never held.
    expect((await accountant.post('/expense-transactions', expense('Office Depot', '9.00'))).status).toBe(201);
    expect(await expenseCount()).toBe(2);

    const waiting = await accountant.get('/approvals?status=pending');
    expect(waiting.body.needs_approval).toBe(true);
    expect(waiting.body.requests).toHaveLength(1);
    expect(waiting.body.requests[0]).toMatchObject({ action: 'expense.create', summary: 'New expense to Staples', amount: '45.0000', status: 'pending', requested_by: 'Test User' });
    expect((await accountant.get('/approvals/pending-count')).body).toEqual({ count: 1 });
    // Staff see their own request; they cannot approve it.
    expect((await staff.get('/approvals')).body.requests).toHaveLength(1);
    expect((await staff.post(`/approvals/${waiting.body.requests[0].id}/approve`)).status).toBe(403);

    // Approving records it, through the same route, and only once.
    const approved = await accountant.post(`/approvals/${waiting.body.requests[0].id}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('approved');
    expect(await expenseCount()).toBe(3);
    const recorded = await t.db.selectFrom('expense_transactions').selectAll()
      .where('business_id', '=', bizId).where('payee_text', '=', 'Staples').where('total_amount', '=', '45.00').executeTakeFirstOrThrow();
    expect(recorded.journal_entry_id).not.toBeNull();
    expect((await accountant.post(`/approvals/${waiting.body.requests[0].id}/approve`)).status).toBe(409);
    expect(await expenseCount()).toBe(3);
    expect((await accountant.get('/approvals/pending-count')).body).toEqual({ count: 0 });
  });

  it('rejects with a note, and keeps a request waiting when it cannot be recorded', async () => {
    const admin = await signIn('admin@x.com');
    const staff = await signIn('staff@x.com');
    const accountant = await signIn('accountant@x.com');
    await admin.patch('', { staff_entries_need_approval: true });

    await staff.post('/expense-transactions', expense('Wrong Vendor', '10.00'));
    // No period exists for this date, so recording it is refused.
    await staff.post('/expense-transactions', expense('Next Decade', '12.00', `${year + 5}-01-10`));
    const waiting = (await accountant.get('/approvals?status=pending')).body.requests as { id: string; summary: string }[];
    const wrong = waiting.find(r => r.summary.includes('Wrong Vendor'))!;
    const future = waiting.find(r => r.summary.includes('Next Decade'))!;

    const rejected = await accountant.post(`/approvals/${wrong.id}/reject`, { note: 'This was a personal purchase.' });
    expect(rejected.body.status).toBe('rejected');
    const mine = (await staff.get('/approvals')).body.requests as { id: string; status: string; decision_note: string | null }[];
    expect(mine.find(r => r.id === wrong.id)).toMatchObject({ status: 'rejected', decision_note: 'This was a personal purchase.' });
    expect((await accountant.post(`/approvals/${wrong.id}/approve`)).status).toBe(409);

    const refused = await accountant.post(`/approvals/${future.id}/approve`);
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(refused.body.error?.message).toBeTruthy();
    // Still waiting, so it can be fixed or rejected; nothing was recorded.
    expect((await accountant.get('/approvals/pending-count')).body).toEqual({ count: 1 });
    expect(await expenseCount()).toBe(0);
  });
});
