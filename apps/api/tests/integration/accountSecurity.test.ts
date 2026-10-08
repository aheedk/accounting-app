// Signing in and accounts, through the HTTP layer: the hold after wrong
// passwords, changing and resetting a password, switching a login off, the
// second step, and a person's sessions.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeUser } from '../helpers/factories.js';
import { makeApp } from '../../src/app.js';
import { destroyDbSingleton } from '../../src/db/index.js';
import { clearAccessTokenRevocations } from '../../src/services/auth/sessionRevocation.js';
import { totpCode } from '../../src/services/auth/totp.js';

const PASSWORD = 'first-password-1';

describe('accounts and signing in', () => {
  let t: TestDb;
  let app: Express;
  let firmId: string;

  beforeAll(async () => {
    process.env['FIELD_ENCRYPTION_KEY'] = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
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
    clearAccessTokenRevocations();
    firmId = (await makeFirm(t.db)).id;
    await makeUser(t.db, firmId, { email: 'admin@x.com', password: PASSWORD, role: 'firm_admin' });
    await makeUser(t.db, firmId, { email: 'pat@x.com', password: PASSWORD, role: 'accountant' });
  });

  type Session = { token: string; cookie: string; status: number; body: { error?: { code: string; message: string } } };

  async function signIn(email: string, password = PASSWORD, code?: string): Promise<Session> {
    const res = await request(app).post('/auth/login').send({ email, password, ...(code ? { code } : {}) });
    const cookie = (res.headers['set-cookie'] as unknown as string[] | undefined)?.[0]?.split(';')[0] ?? '';
    return { token: res.body.access_token as string, cookie, status: res.status, body: res.body };
  }
  const as = (s: Session) => ({
    get: (url: string) => request(app).get(url).set('Authorization', `Bearer ${s.token}`).set('Cookie', s.cookie),
    post: (url: string, body: object = {}) => request(app).post(url).set('Authorization', `Bearer ${s.token}`).set('Cookie', s.cookie).send(body),
    del: (url: string) => request(app).delete(url).set('Authorization', `Bearer ${s.token}`).set('Cookie', s.cookie),
  });
  const userId = async (email: string) =>
    (await t.db.selectFrom('users').select('id').where('email', '=', email).executeTakeFirstOrThrow()).id;

  it('holds a login after five wrong passwords, and a firm admin lifts the hold with a new password', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await signIn('pat@x.com', 'wrong-password')).status).toBe(401);
    }
    // Held now, even with the right password.
    const held = await signIn('pat@x.com');
    expect(held.status).toBe(429);
    expect(held.body.error).toMatchObject({ code: 'ACCOUNT_LOCKED' });

    const admin = await signIn('admin@x.com');
    const reset = await as(admin).post(`/me/firm/users/${await userId('pat@x.com')}/reset-password`);
    expect(reset.status).toBe(200);
    const fresh = reset.body.plaintext_password as string;
    expect(fresh.length).toBeGreaterThanOrEqual(12);
    expect((await signIn('pat@x.com')).status).toBe(401);          // the old password is gone
    expect((await signIn('pat@x.com', fresh)).status).toBe(200);
  });

  it('changes a password: the old one stops working, other browsers are signed out, this one stays', async () => {
    const here = await signIn('pat@x.com');
    const elsewhere = await signIn('pat@x.com');

    const wrong = await as(here).post('/auth/password', { current_password: 'not-it-at-all', new_password: 'second-password-2' });
    expect(wrong.status).toBe(409);
    expect((await as(here).post('/auth/password', { current_password: PASSWORD, new_password: 'short' })).status).toBe(400);

    expect((await as(here).post('/auth/password', { current_password: PASSWORD, new_password: 'second-password-2' })).status).toBe(200);
    expect((await signIn('pat@x.com')).status).toBe(401);
    expect((await signIn('pat@x.com', 'second-password-2')).status).toBe(200);

    // The other browser is out at once and cannot renew its session; this one carries on.
    expect((await as(elsewhere).get('/me')).status).toBe(401);
    expect((await request(app).post('/auth/refresh').set('Cookie', elsewhere.cookie)).status).toBe(401);
    expect((await as(here).get('/me')).status).toBe(200);
    expect((await request(app).post('/auth/refresh').set('Cookie', here.cookie)).status).toBe(200);
  });

  it('switches a login off at once, and back on', async () => {
    const admin = await signIn('admin@x.com');
    const pat = await signIn('pat@x.com');
    const patId = await userId('pat@x.com');
    expect((await as(pat).get('/me')).status).toBe(200);

    expect((await as(admin).post(`/me/firm/users/${patId}/deactivate`)).status).toBe(200);
    // The session Pat already had stops, not just new sign-ins.
    expect((await as(pat).get('/me')).status).toBe(401);
    expect((await request(app).post('/auth/refresh').set('Cookie', pat.cookie)).status).toBe(401);
    const refused = await signIn('pat@x.com');
    expect(refused.status).toBe(403);
    expect(refused.body.error?.message).toMatch(/switched off/);

    const list = await as(admin).get('/me/firm/users');
    expect(list.body.users.find((u: { email: string }) => u.email === 'pat@x.com').deactivated_at).not.toBeNull();

    expect((await as(admin).post(`/me/firm/users/${patId}/reactivate`)).status).toBe(200);
    expect((await signIn('pat@x.com')).status).toBe(200);
  });

  it('will not switch off your own login or the only firm admin', async () => {
    const admin = await signIn('admin@x.com');
    const self = await as(admin).post(`/me/firm/users/${await userId('admin@x.com')}/deactivate`);
    expect(self.status).toBe(409);
    expect(self.body.error.message).toMatch(/your own login/);

    const pat = await signIn('pat@x.com');
    // Only a firm admin reaches these at all.
    expect((await as(pat).post(`/me/firm/users/${await userId('admin@x.com')}/deactivate`)).status).toBe(403);
  });

  it('asks for a code once the second step is on, and a firm admin can turn it off for a lost phone', async () => {
    const pat = await signIn('pat@x.com');
    const setup = await as(pat).post('/auth/two-step/setup');
    expect(setup.status).toBe(200);
    const secret = setup.body.secret as string;
    expect(setup.body.otpauth_uri).toContain(secret);

    // Not on until confirmed: an abandoned set-up locks nobody out.
    expect((await signIn('pat@x.com')).status).toBe(200);
    expect((await as(pat).post('/auth/two-step/confirm', { code: '000000' })).status).toBe(409);
    expect((await as(pat).post('/auth/two-step/confirm', { code: totpCode(secret) })).status).toBe(200);
    expect((await as(pat).get('/auth/account')).body.two_step_enabled).toBe(true);

    const noCode = await signIn('pat@x.com');
    expect(noCode.status).toBe(401);
    expect(noCode.body.error).toMatchObject({ code: 'TWO_STEP_REQUIRED' });
    expect(noCode.token).toBeUndefined();
    const offByOne = totpCode(secret) === '000000' ? '000001' : '000000';
    expect((await signIn('pat@x.com', PASSWORD, offByOne)).status).toBe(401);
    expect((await signIn('pat@x.com', PASSWORD, totpCode(secret))).status).toBe(200);

    const admin = await signIn('admin@x.com');
    expect((await as(admin).post(`/me/firm/users/${await userId('pat@x.com')}/reset-two-step`)).status).toBe(200);
    expect((await signIn('pat@x.com')).status).toBe(200);
  });

  it('lists where a person is signed in, and signs the others out', async () => {
    const here = await signIn('pat@x.com');
    const second = await signIn('pat@x.com');
    await signIn('pat@x.com');

    const before = await as(here).get('/auth/account');
    expect(before.body.sessions).toHaveLength(3);
    expect(before.body.sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);

    const one = before.body.sessions.find((s: { current: boolean }) => !s.current) as { id: string };
    expect((await as(here).del(`/auth/sessions/${one.id}`)).body).toEqual({ ended: 1 });
    expect((await as(here).post('/auth/sessions/sign-out-others')).body).toEqual({ ended: 1 });

    const after = await as(here).get('/auth/account');
    expect(after.body.sessions).toHaveLength(1);
    expect(after.body.sessions[0].current).toBe(true);
    expect((await as(second).get('/me')).status).toBe(401);

    // Signing out ends this browser's access at once too, not when the token expires.
    await request(app).post('/auth/logout').set('Cookie', here.cookie);
    expect((await as(here).get('/me')).status).toBe(401);
  });
});
