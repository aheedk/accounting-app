// Access by area: payroll can be closed to a login (role audit 2026-10-08).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, grantAccess, seedCoa } from '../helpers/factories.js';
import { makeApp } from '../../src/app.js';
import { destroyDbSingleton } from '../../src/db/index.js';

const PASSWORD = 'pw12345678';
const PAYROLL = ['employees', 'pay-runs', 'payroll-overview', 'payroll-tax-liabilities', 'compliance-items'];

describe('payroll access', () => {
  let t: TestDb;
  let app: Express;
  let bizId: string;

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
    const biz = await makeBusiness(t.db, firm.id, 'Payroll Co');
    bizId = biz.id;
    await seedCoa(t.db, biz.id);
    await makeUser(t.db, firm.id, { email: 'admin@x.com', password: PASSWORD, role: 'firm_admin' });
    const staff = await makeUser(t.db, firm.id, { email: 'staff@x.com', password: PASSWORD, role: 'staff' });
    await grantAccess(t.db, staff.id, biz.id);
  });

  async function signIn(email: string) {
    const res = await request(app).post('/auth/login').send({ email, password: PASSWORD });
    const token = res.body.access_token as string;
    return {
      user: res.body.user as { id: string; payroll_access: boolean },
      get: (url: string) => request(app).get(url).set('Authorization', `Bearer ${token}`),
      post: (url: string, body: object) => request(app).post(url).set('Authorization', `Bearer ${token}`).send(body),
    };
  }

  it('is open by default, closes for a login a firm admin switches it off for, and opens again', async () => {
    const admin = await signIn('admin@x.com');
    let staff = await signIn('staff@x.com');
    expect(staff.user.payroll_access).toBe(true);
    for (const area of PAYROLL) expect((await staff.get(`/businesses/${bizId}/${area}`)).status, area).toBe(200);

    expect((await admin.post(`/me/firm/users/${staff.user.id}/payroll-access`, { allowed: false })).status).toBe(200);
    // At once, on the session the staff member already has.
    for (const area of PAYROLL) {
      const res = await staff.get(`/businesses/${bizId}/${area}`);
      expect(res.status, area).toBe(403);
      expect(res.body.error.message).toMatch(/Payroll is not part of your access/);
    }
    // Everything else is as it was.
    expect((await staff.get(`/businesses/${bizId}/customers`)).status).toBe(200);
    expect((await staff.get('/me')).body.user.payroll_access).toBe(false);
    staff = await signIn('staff@x.com');
    expect(staff.user.payroll_access).toBe(false);

    expect((await admin.post(`/me/firm/users/${staff.user.id}/payroll-access`, { allowed: true })).status).toBe(200);
    expect((await staff.get(`/businesses/${bizId}/employees`)).status).toBe(200);
  });

  it('a firm admin always has payroll, and only a firm admin can change the switch', async () => {
    const admin = await signIn('admin@x.com');
    const staff = await signIn('staff@x.com');
    expect(admin.user.payroll_access).toBe(true);
    const self = await admin.post(`/me/firm/users/${admin.user.id}/payroll-access`, { allowed: false });
    expect(self.status).toBe(409);
    expect((await admin.get(`/businesses/${bizId}/employees`)).status).toBe(200);
    expect((await staff.post(`/me/firm/users/${staff.user.id}/payroll-access`, { allowed: true })).status).toBe(403);
  });
});
