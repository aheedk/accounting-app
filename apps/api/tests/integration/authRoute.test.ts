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
});
