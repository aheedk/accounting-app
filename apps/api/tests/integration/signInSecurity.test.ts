// Signing in, second pass (security review 2026-10-21): a password a firm admin
// made is replaced before the app opens, the firm can require the second step,
// a code is good once, a copied sign-in key ends its session, a session ends
// when left alone or after 12 hours, and guessing the current password from
// inside a session ends it.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { sql } from 'kysely';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeBusiness, makeFirm, makeUser } from '../helpers/factories.js';
import { makeApp } from '../../src/app.js';
import { destroyDbSingleton } from '../../src/db/index.js';
import { clearAccessTokenRevocations } from '../../src/services/auth/sessionRevocation.js';
import { totpCode } from '../../src/services/auth/totp.js';
import { DOCUMENTS_PER_HOUR, documentUploads } from '../../src/routes/ai.js';

const PASSWORD = 'first-password-1';

describe('signing in, second pass', () => {
  let t: TestDb;
  let app: Express;
  let firmId: string;
  let businessId: string;

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
    businessId = (await makeBusiness(t.db, firmId)).id;
    await makeUser(t.db, firmId, { email: 'admin@x.com', password: PASSWORD, role: 'firm_admin' });
    await makeUser(t.db, firmId, { email: 'pat@x.com', password: PASSWORD, role: 'accountant', full_name: 'Pat Lee' });
  });

  type Session = {
    token: string; cookie: string; status: number;
    body: { error?: { code: string; message: string }; user?: { setup_required: string[]; idle_sign_out_minutes: number } };
    maxAge: number | null;
  };

  function read(res: request.Response): Session {
    const setCookie = (res.headers['set-cookie'] as unknown as string[] | undefined)?.[0] ?? '';
    const maxAge = /Max-Age=(\d+)/.exec(setCookie)?.[1];
    return { token: res.body.access_token as string, cookie: setCookie.split(';')[0] ?? '', status: res.status, body: res.body, maxAge: maxAge ? Number(maxAge) : null };
  }
  async function signIn(email: string, password = PASSWORD, code?: string): Promise<Session> {
    return read(await request(app).post('/auth/login').send({ email, password, ...(code ? { code } : {}) }));
  }
  const renew = async (cookie: string) => read(await request(app).post('/auth/refresh').set('Cookie', cookie));
  const as = (s: Session) => ({
    get: (url: string) => request(app).get(url).set('Authorization', `Bearer ${s.token}`).set('Cookie', s.cookie),
    post: (url: string, body: object = {}) => request(app).post(url).set('Authorization', `Bearer ${s.token}`).set('Cookie', s.cookie).send(body),
    patch: (url: string, body: object = {}) => request(app).patch(url).set('Authorization', `Bearer ${s.token}`).set('Cookie', s.cookie).send(body),
  });
  const userId = async (email: string) =>
    (await t.db.selectFrom('users').select('id').where('email', '=', email).executeTakeFirstOrThrow()).id;

  it('makes a login with a password from a firm admin choose its own before anything else opens', async () => {
    const admin = await signIn('admin@x.com');
    const made = await as(admin).post('/me/firm/users', { email: 'sam@x.com', full_name: 'Sam Ortiz', role: 'firm_admin' });
    expect(made.status).toBe(201);
    const temp = made.body.plaintext_password as string;

    const sam = await signIn('sam@x.com', temp);
    expect(sam.status).toBe(200);
    expect(sam.body.user?.setup_required).toEqual(['password']);
    // Only the person's own account opens.
    const refused = await as(sam).get('/me/firm/users');
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('ACCOUNT_SETUP_REQUIRED');
    expect((await as(sam).get(`/businesses/${businessId}/customers`)).status).toBe(403);
    expect((await as(sam).get('/me')).body.user.setup_required).toEqual(['password']);
    expect((await as(sam).get('/auth/account')).status).toBe(200);

    // Easily guessed passwords, and the person's own name, are refused.
    expect((await as(sam).post('/auth/password', { current_password: temp, new_password: 'Password2026!' })).status).toBe(400);
    expect((await as(sam).post('/auth/password', { current_password: temp, new_password: '1234567890' })).status).toBe(400);
    const named = await as(sam).post('/auth/password', { current_password: temp, new_password: 'ortiz-likes-ledgers' });
    expect(named.status).toBe(409);
    expect(named.body.error.message).toMatch(/email or name/);

    expect((await as(sam).post('/auth/password', { current_password: temp, new_password: 'brass-lantern-river-9' })).status).toBe(200);
    const renewed = await renew(sam.cookie);
    expect(renewed.status).toBe(200);
    expect(renewed.body.user?.setup_required).toEqual([]);
    expect((await as(renewed).get('/me/firm/users')).status).toBe(200);
  });

  it('a reset password is also replaced at the next sign-in', async () => {
    const admin = await signIn('admin@x.com');
    const reset = await as(admin).post(`/me/firm/users/${await userId('pat@x.com')}/reset-password`);
    const pat = await signIn('pat@x.com', reset.body.plaintext_password as string);
    expect(pat.body.user?.setup_required).toEqual(['password']);
  });

  it('requires the second step of every login once the firm turns it on', async () => {
    const admin = await signIn('admin@x.com');
    // Not before the admin has it, so turning it on cannot lock them out.
    const early = await as(admin).patch('/me/firm/security', { require_two_step: true });
    expect(early.status).toBe(409);
    expect(early.body.error.message).toMatch(/your own second step first/);

    const setup = await as(admin).post('/auth/two-step/setup');
    await as(admin).post('/auth/two-step/confirm', { code: totpCode(setup.body.secret as string) });
    const on = await as(admin).patch('/me/firm/security', { require_two_step: true, idle_sign_out_minutes: 30 });
    expect(on.status).toBe(200);
    expect(on.body).toEqual({ require_two_step: true, idle_sign_out_minutes: 30 });
    expect((await as(admin).patch('/me/firm/security', { idle_sign_out_minutes: 45 })).status).toBe(400);
    const log = await t.db.selectFrom('audit_logs').select('action').where('action', '=', 'firm.security_update').execute();
    expect(log).toHaveLength(1);

    // Pat has no second step: signed in, but only to set it up.
    const pat = await signIn('pat@x.com');
    expect(pat.body.user?.setup_required).toEqual(['two_step']);
    expect(pat.body.user?.idle_sign_out_minutes).toBe(30);
    expect((await as(pat).get(`/businesses/${businessId}/customers`)).status).toBe(403);
    const patSetup = await as(pat).post('/auth/two-step/setup');
    expect(patSetup.status).toBe(200);
    expect((await as(pat).post('/auth/two-step/confirm', { code: totpCode(patSetup.body.secret as string) })).status).toBe(200);
    expect((await renew(pat.cookie)).body.user?.setup_required).toEqual([]);

    // While the firm requires it, it cannot be turned off from the account page.
    const off = await as(pat).post('/auth/two-step/off', { password: PASSWORD });
    expect(off.status).toBe(409);
    expect(off.body.error.message).toMatch(/requires the second step/);
  });

  it('takes each code once', async () => {
    const pat = await signIn('pat@x.com');
    const secret = (await as(pat).post('/auth/two-step/setup')).body.secret as string;
    await as(pat).post('/auth/two-step/confirm', { code: totpCode(secret) });

    const next = totpCode(secret, Date.now() + 30_000);
    expect((await signIn('pat@x.com', PASSWORD, next)).status).toBe(200);
    const again = await signIn('pat@x.com', PASSWORD, next);
    expect(again.status).toBe(401);
    expect(again.body.error?.message).toMatch(/already used/);
  });

  it('ends the session when a replaced sign-in key comes back, but not for two tabs renewing at once', async () => {
    const pat = await signIn('pat@x.com');
    const second = await renew(pat.cookie);
    expect(second.status).toBe(200);

    // Straight away, the old key is only refused: another tab may have renewed a moment before.
    expect((await renew(pat.cookie)).status).toBe(401);
    const third = await renew(second.cookie);
    expect(third.status).toBe(200);

    // Minutes later it is a copy: the whole session ends, the newest key with it.
    await t.db.updateTable('refresh_tokens').set({ revoked_at: sql`now() - interval '2 minutes'` })
      .where('revoked_at', 'is not', null).execute();
    expect((await renew(second.cookie)).status).toBe(401);
    expect((await renew(third.cookie)).status).toBe(401);
    expect((await as(third).get('/me')).status).toBe(401);
    const log = await t.db.selectFrom('audit_logs').select('action').where('action', '=', 'auth.refresh_reuse').execute();
    expect(log).toHaveLength(1);
  });

  it("ends a session left alone past the firm's limit, or 12 hours after signing in", async () => {
    await t.db.updateTable('firms').set({ idle_sign_out_minutes: 15 }).where('id', '=', firmId).execute();
    const idle = await signIn('pat@x.com');
    expect(idle.body.user?.idle_sign_out_minutes).toBe(15);
    // The cookie lasts no longer than the session may.
    expect(idle.maxAge).toBeGreaterThan(14 * 60);
    expect(idle.maxAge).toBeLessThanOrEqual(15 * 60);

    const busy = await signIn('pat@x.com');
    await t.db.updateTable('refresh_tokens').set({ created_at: sql`now() - interval '16 minutes'` })
      .where('session_id', '=', sql<string>`(select session_id from refresh_tokens order by created_at asc limit 1)`).execute();
    expect((await renew(idle.cookie)).status).toBe(401);
    expect((await renew(busy.cookie)).status).toBe(200);

    const long = await signIn('pat@x.com');
    await t.db.updateTable('refresh_tokens').set({ session_started_at: sql`now() - interval '13 hours'` }).execute();
    expect((await renew(long.cookie)).status).toBe(401);
  });

  it('ends every session after five wrong current passwords from inside one', async () => {
    const pat = await signIn('pat@x.com');
    for (let i = 0; i < 4; i++) {
      expect((await as(pat).post('/auth/password', { current_password: 'not-it-at-all', new_password: 'brass-lantern-river-9' })).status).toBe(409);
    }
    expect((await as(pat).get('/me')).status).toBe(200);
    expect((await as(pat).post('/auth/two-step/off', { password: 'not-it-at-all' })).status).toBe(409);
    expect((await as(pat).get('/me')).status).toBe(401);
    expect((await signIn('pat@x.com')).status).toBe(429);
  });

  it('marks every API response as not to be cached or framed, and does not say what it runs on', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('a firm role taken away stops at once in a browser already open, not when its token runs out', async () => {
    const admin = await signIn('admin@x.com');
    await makeUser(t.db, firmId, { email: 'sam@x.com', password: PASSWORD, role: 'firm_admin' });
    const sam = await signIn('sam@x.com');
    expect((await as(sam).get('/me/firm/users')).status).toBe(200);

    expect((await as(admin).patch(`/me/firm/users/${await userId('sam@x.com')}`, { role: 'staff' })).status).toBe(200);
    // The old token, which says firm admin, no longer counts; renewing gives one that says staff.
    expect((await as(sam).get('/me/firm/users')).status).toBe(401);
    const renewed = await renew(sam.cookie);
    expect(renewed.status).toBe(200);
    expect((await as(renewed).get('/me/firm/users')).status).toBe(403);
  });

  it('caps the documents one login sends to the AI in an hour', async () => {
    const admin = await signIn('admin@x.com');
    const adminId = await userId('admin@x.com');
    documentUploads.reset();
    for (let i = 0; i < DOCUMENTS_PER_HOUR; i++) documentUploads.take(adminId);
    const res = await request(app).post(`/businesses/${businessId}/ai/documents`)
      .set('Authorization', `Bearer ${admin.token}`)
      .attach('file', Buffer.from('%PDF-1.4 %%EOF'), { filename: 'receipt.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    documentUploads.reset();
  });

  it("writes what the web app's script policy would have blocked to the log, without the query string", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const res = await request(app).post('/csp-report').set('Content-Type', 'application/csp-report').send(JSON.stringify({
      'csp-report': { 'document-uri': 'https://app.example/invoices?customer=Pat', 'effective-directive': 'script-src-elem', 'blocked-uri': 'https://evil.example/x.js' },
    }));
    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledWith('[csp] script-src-elem blocked https://evil.example/x.js on https://app.example/invoices');
    warn.mockRestore();
  });
});
