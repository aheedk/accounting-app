// apps/api/tests/integration/authRoute.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, grantAccess } from '../helpers/factories.js';
import { makeApp } from '../../src/app.js';
import { destroyDbSingleton } from '../../src/db/index.js';

// NOTE: routes import `db` from '../db/index.js' — we rebind it for tests by
// setting DATABASE_URL to the container's URL before app instantiation.

describe('auth routes', () => {
  let t: TestDb;

  beforeAll(async () => {
    t = await startTestDb();
    process.env.DATABASE_URL = t.url;
  });
  afterAll(async () => {
    // Destroy the route singleton's pg pool BEFORE the testcontainer stops, so
    // we don't leak an unhandled "terminating connection" error from the
    // container yanking our sockets.
    await destroyDbSingleton();
    await stopTestDb();
  });
  beforeEach(async () => { await truncateAll(t.db); });

  it('POST /auth/login returns access + sets refresh cookie', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id, 'Biz');
    const user = await makeUser(t.db, firm.id, { email: 'a@x.com', password: 'pw12345678' });
    await grantAccess(t.db, user.id, biz.id);

    const app = makeApp();
    const res = await request(app).post('/auth/login').send({ email: 'a@x.com', password: 'pw12345678' });
    expect(res.status).toBe(200);
    expect(res.body.access_token).toBeTruthy();
    expect(res.body.user.id).toBe(user.id);
    expect(res.headers['set-cookie']?.join(';') ?? '').toMatch(/acct_rt=/);
  });

  it('POST /auth/login wrong password returns 401', async () => {
    const firm = await makeFirm(t.db);
    await makeUser(t.db, firm.id, { email: 'a@x.com', password: 'pw12345678' });
    const app = makeApp();
    const res = await request(app).post('/auth/login').send({ email: 'a@x.com', password: 'wrongpass' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  // Role audit 2026-10-08: /me built its own list from explicit grants only, so a
  // firm admin kept every client on sign-in and lost the ungranted ones on reload.
  it('GET /me lists the same businesses as signing in: all of the firm for a firm admin, granted ones for others', async () => {
    const firm = await makeFirm(t.db);
    const granted = await makeBusiness(t.db, firm.id, 'Granted Co');
    await makeBusiness(t.db, firm.id, 'Other Co');
    await makeUser(t.db, firm.id, { email: 'admin@x.com', password: 'pw12345678', role: 'firm_admin' });
    const accountant = await makeUser(t.db, firm.id, { email: 'acct@x.com', password: 'pw12345678', role: 'accountant' });
    await grantAccess(t.db, accountant.id, granted.id);

    const app = makeApp();
    const names = async (email: string) => {
      const login = await request(app).post('/auth/login').send({ email, password: 'pw12345678' });
      const me = await request(app).get('/me').set('Authorization', `Bearer ${login.body.access_token as string}`);
      const list = (body: { businesses: { name: string }[] }) => body.businesses.map(b => b.name).sort();
      expect(list(me.body)).toEqual(list(login.body));
      return list(me.body);
    };
    expect(await names('admin@x.com')).toEqual(['Granted Co', 'Other Co']);
    expect(await names('acct@x.com')).toEqual(['Granted Co']);
  });
});
