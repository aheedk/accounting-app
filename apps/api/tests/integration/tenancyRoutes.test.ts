// Regression test for the route-mounted tenancy middleware. Exercises the
// HTTP layer end-to-end (auth -> :businessId param capture -> resolveBusiness
// -> handler) to catch the class of bug where router.use(mw) fired before
// :businessId was parsed, making every /businesses/:businessId/* path 404.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, grantAccess, seedCoa, makeCustomer } from '../helpers/factories.js';
import { makeApp } from '../../src/app.js';
import { destroyDbSingleton } from '../../src/db/index.js';

describe('tenancy-scoped HTTP routes', () => {
  let t: TestDb;

  beforeAll(async () => {
    t = await startTestDb();
    process.env.DATABASE_URL = t.url;
  });
  afterAll(async () => {
    await destroyDbSingleton();
    await stopTestDb();
  });
  beforeEach(async () => { await truncateAll(t.db); });

  async function loggedInRequest() {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id, 'Tenancy Test Co');
    const user = await makeUser(t.db, firm.id, { email: 'tenancy@x.com', password: 'pw12345678' });
    await grantAccess(t.db, user.id, biz.id);
    await seedCoa(t.db, biz.id);
    await makeCustomer(t.db, biz.id, { name: 'Acme HTTP' });
    const app = makeApp();
    const login = await request(app).post('/auth/login').send({ email: 'tenancy@x.com', password: 'pw12345678' });
    return { app, token: login.body.access_token as string, firm, biz, user };
  }

  it('GET /businesses/:id/customers resolves the :businessId param and returns the customer list', async () => {
    const { app, token, biz } = await loggedInRequest();
    const res = await request(app)
      .get(`/businesses/${biz.id}/customers`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.customers).toHaveLength(1);
    expect(res.body.customers[0].name).toBe('Acme HTTP');
  });

  it('GET /businesses/:id/coa returns the seeded chart of accounts', async () => {
    const { app, token, biz } = await loggedInRequest();
    const res = await request(app)
      .get(`/businesses/${biz.id}/coa`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.accounts.length).toBeGreaterThan(10);
    const ar = res.body.accounts.find((a: { code: string }) => a.code === '1100');
    expect(ar).toBeTruthy();
  });

  it('GET with a non-existent :businessId returns 404 (not 500)', async () => {
    const { app, token } = await loggedInRequest();
    const res = await request(app)
      .get('/businesses/00000000-0000-0000-0000-000000000000/customers')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('GET without Authorization header returns 401', async () => {
    const { app, biz } = await loggedInRequest();
    const res = await request(app).get(`/businesses/${biz.id}/customers`);
    expect(res.status).toBe(401);
  });
});
