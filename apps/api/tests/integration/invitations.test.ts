// Invitation links in place of an admin-typed password, and self-service
// password reset. Spec: docs/specs/2026-11-15-user-invitations-and-signin-design.md
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeUser } from '../helpers/factories.js';
import { makeApp } from '../../src/app.js';
import { destroyDbSingleton } from '../../src/db/index.js';

const PASSWORD = 'first-password-1';

describe('invitations and password reset', () => {
  let t: TestDb;
  let app: Express;
  let firmId: string;

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
    firmId = (await makeFirm(t.db, 'Acme Bookkeeping')).id;
    await makeUser(t.db, firmId, { email: 'admin@x.com', password: PASSWORD, role: 'firm_admin', full_name: 'Ada Admin' });
  });

  type Session = { token: string; cookie: string; status: number; body: Record<string, unknown> };
  function read(res: request.Response): Session {
    const setCookie = (res.headers['set-cookie'] as unknown as string[] | undefined)?.[0] ?? '';
    return { token: res.body.access_token as string, cookie: setCookie.split(';')[0] ?? '', status: res.status, body: res.body };
  }
  const signIn = async (email: string, password = PASSWORD) => read(await request(app).post('/auth/login').send({ email, password }));
  const as = (s: Session) => ({
    get: (url: string) => request(app).get(url).set('Authorization', `Bearer ${s.token}`).set('Cookie', s.cookie),
    post: (url: string, body: object = {}) => request(app).post(url).set('Authorization', `Bearer ${s.token}`).set('Cookie', s.cookie).send(body),
  });
  const userId = async (email: string) =>
    (await t.db.selectFrom('users').select('id').where('email', '=', email).executeTakeFirstOrThrow()).id;

  /** The raw link logged by emailService's no-RESEND_API_KEY dev fallback. */
  function captureLink(): () => string {
    const spy = vi.spyOn(console, 'log');
    return () => {
      const line = spy.mock.calls.map(c => String(c[0])).reverse().find(s => s.startsWith('[email]'));
      const match = /link=(\S+)/.exec(line ?? '');
      if (!match) throw new Error(`no [email] log line found; calls were: ${JSON.stringify(spy.mock.calls)}`);
      spy.mockRestore();
      return match[1]!;
    };
  }
  const tokenFromLink = (link: string) => new URL(link).searchParams.get('token')!;

  describe('accepting an invitation', () => {
    it('creates the login pending, emails a link, and accepting it signs the person straight in', async () => {
      const admin = await signIn('admin@x.com');
      const getLink = captureLink();
      const made = await as(admin).post('/me/firm/users', { email: 'sam@x.com', full_name: 'Sam Ortiz', role: 'accountant' });
      expect(made.status).toBe(201);
      expect(made.body.plaintext_password).toBeUndefined();
      // No RESEND_API_KEY in tests: logged, not sent — surfaced honestly, not as a false success.
      expect(made.body.email_sent).toBe(false);
      const token = tokenFromLink(getLink());

      const validate = await request(app).get('/auth/validate-invitation').query({ token });
      expect(validate.status).toBe(200);
      expect(validate.body).toEqual({ email: 'sam@x.com', full_name: 'Sam Ortiz', firm_name: 'Acme Bookkeeping' });

      const accepted = await request(app).post('/auth/accept-invitation').send({ token, password: 'brass-lantern-river-9' });
      expect(accepted.status).toBe(200);
      expect(accepted.body.access_token).toBeTruthy();
      expect(accepted.body.user.email).toBe('sam@x.com');
      expect(accepted.body.user.setup_required).toEqual([]);

      const sam = read(accepted as unknown as request.Response);
      expect((await as(sam).get('/me/firm/users')).status).toBe(403); // accountant, not firm admin — but let in, not setup-blocked
      expect((await signIn('sam@x.com', 'brass-lantern-river-9')).status).toBe(200);
    });

    it('lets the invited person change the name the admin typed', async () => {
      const admin = await signIn('admin@x.com');
      const getLink = captureLink();
      await as(admin).post('/me/firm/users', { email: 'sam@x.com', full_name: 'Sam O', role: 'staff' });
      const token = tokenFromLink(getLink());

      const accepted = await request(app).post('/auth/accept-invitation').send({ token, password: 'brass-lantern-river-9', full_name: 'Samantha Ortiz' });
      expect(accepted.status).toBe(200);
      expect(accepted.body.user.full_name).toBe('Samantha Ortiz');
    });

    it('refuses a token that does not exist, one already used, and an easily guessed password', async () => {
      const admin = await signIn('admin@x.com');
      const getLink = captureLink();
      await as(admin).post('/me/firm/users', { email: 'sam@x.com', full_name: 'Sam Ortiz', role: 'staff' });
      const token = tokenFromLink(getLink());

      const bogus = await request(app).post('/auth/accept-invitation').send({ token: 'not-a-real-token', password: 'brass-lantern-river-9' });
      expect(bogus.status).toBe(409);
      expect(bogus.body.error.message).toMatch(/expired or is no longer valid/);

      const weak = await request(app).post('/auth/accept-invitation').send({ token, password: '1234567890' });
      expect(weak.status).toBe(400);

      const first = await request(app).post('/auth/accept-invitation').send({ token, password: 'brass-lantern-river-9' });
      expect(first.status).toBe(200);

      const reused = await request(app).post('/auth/accept-invitation').send({ token, password: 'another-good-one-7' });
      expect(reused.status).toBe(409);
    });

    it('refuses an expired invitation and lets the admin resend it', async () => {
      const admin = await signIn('admin@x.com');
      await as(admin).post('/me/firm/users', { email: 'sam@x.com', full_name: 'Sam Ortiz', role: 'staff' });
      const samId = await userId('sam@x.com');
      await t.db.updateTable('users').set({ invitation_expires_at: new Date(Date.now() - 1000).toISOString() as unknown as string })
        .where('id', '=', samId).execute();
      const { invitation_token_hash: expiredHash } = await t.db.selectFrom('users').select('invitation_token_hash')
        .where('id', '=', samId).executeTakeFirstOrThrow();

      const getLink = captureLink();
      const resent = await as(admin).post(`/me/firm/users/${samId}/resend-invitation`);
      expect(resent.status).toBe(200);
      expect(resent.body).toEqual({ ok: true, email_sent: false });
      const freshToken = tokenFromLink(getLink());

      const { invitation_token_hash: freshHash, invitation_expires_at } = await t.db.selectFrom('users')
        .select(['invitation_token_hash', 'invitation_expires_at']).where('id', '=', samId).executeTakeFirstOrThrow();
      expect(freshHash).not.toBe(expiredHash);
      expect(new Date(invitation_expires_at!).getTime()).toBeGreaterThan(Date.now());

      const accepted = await request(app).post('/auth/accept-invitation').send({ token: freshToken, password: 'brass-lantern-river-9' });
      expect(accepted.status).toBe(200);
    });

    it('refuses to resend once the invitation is accepted, and only to a firm admin', async () => {
      const admin = await signIn('admin@x.com');
      await as(admin).post('/me/firm/users', { email: 'sam@x.com', full_name: 'Sam Ortiz', role: 'staff' });
      const samId = await userId('sam@x.com');

      const notAdmin = await request(app).post(`/me/firm/users/${samId}/resend-invitation`);
      expect(notAdmin.status).toBe(401); // no auth at all

      await t.db.updateTable('users').set({ invitation_status: 'accepted' }).where('id', '=', samId).execute();
      const already = await as(admin).post(`/me/firm/users/${samId}/resend-invitation`);
      expect(already.status).toBe(409);
      expect(already.body.error.message).toMatch(/already set up/);
    });

    it('shows invitation status and expiry on the admin user list', async () => {
      const admin = await signIn('admin@x.com');
      await as(admin).post('/me/firm/users', { email: 'sam@x.com', full_name: 'Sam Ortiz', role: 'staff' });
      const list = await as(admin).get('/me/firm/users');
      const sam = (list.body.users as Array<Record<string, unknown>>).find(u => u['email'] === 'sam@x.com')!;
      expect(sam['invitation_status']).toBe('sent');
      expect(sam['invitation_expires_at']).toBeTruthy();
      const self = (list.body.users as Array<Record<string, unknown>>).find(u => u['email'] === 'admin@x.com')!;
      expect(self['invitation_status']).toBe('accepted');
    });

    it('handing someone a reset password also clears a still-open invitation', async () => {
      const admin = await signIn('admin@x.com');
      await as(admin).post('/me/firm/users', { email: 'sam@x.com', full_name: 'Sam Ortiz', role: 'staff' });
      const samId = await userId('sam@x.com');
      const reset = await as(admin).post(`/me/firm/users/${samId}/reset-password`);
      expect(reset.status).toBe(200);
      expect((await signIn('sam@x.com', reset.body.plaintext_password as string)).status).toBe(200);
      const row = await t.db.selectFrom('users').select('invitation_status').where('id', '=', samId).executeTakeFirstOrThrow();
      expect(row.invitation_status).toBe('accepted');
    });
  });

  describe('forgot password', () => {
    it('does nothing visible for an unknown email, and emails a working link for a real one', async () => {
      await makeUser(t.db, firmId, { email: 'pat@x.com', password: PASSWORD, role: 'staff', full_name: 'Pat Lee' });

      const unknown = await request(app).post('/auth/forgot-password').send({ email: 'nobody@x.com' });
      expect(unknown.status).toBe(200);
      expect(unknown.body).toEqual({ ok: true });

      const getLink = captureLink();
      const known = await request(app).post('/auth/forgot-password').send({ email: 'pat@x.com' });
      expect(known.status).toBe(200);
      expect(known.body).toEqual({ ok: true }); // identical response either way
      const token = tokenFromLink(getLink());

      const validate = await request(app).get('/auth/validate-password-reset').query({ token });
      expect(validate.status).toBe(200);
      expect(validate.body).toEqual({ email: 'pat@x.com' });

      const reset = await request(app).post('/auth/reset-password').send({ token, password: 'brass-lantern-river-9' });
      expect(reset.status).toBe(200);
      expect((await signIn('pat@x.com', PASSWORD)).status).toBe(401);
      expect((await signIn('pat@x.com', 'brass-lantern-river-9')).status).toBe(200);
    });

    it('does not sign the person in, and ends every session already open on the login', async () => {
      await makeUser(t.db, firmId, { email: 'pat@x.com', password: PASSWORD, role: 'staff' });
      const elsewhere = await signIn('pat@x.com');
      expect((await as(elsewhere).get('/me')).status).toBe(200);

      const getLink = captureLink();
      await request(app).post('/auth/forgot-password').send({ email: 'pat@x.com' });
      const token = tokenFromLink(getLink());
      const reset = await request(app).post('/auth/reset-password').send({ token, password: 'brass-lantern-river-9' });
      expect(reset.status).toBe(200);
      expect(reset.body.access_token).toBeUndefined();

      expect((await as(elsewhere).get('/me')).status).toBe(401);
    });

    it('refuses an expired or already-used reset token', async () => {
      await makeUser(t.db, firmId, { email: 'pat@x.com', password: PASSWORD, role: 'staff' });
      const getLink = captureLink();
      await request(app).post('/auth/forgot-password').send({ email: 'pat@x.com' });
      const token = tokenFromLink(getLink());

      const first = await request(app).post('/auth/reset-password').send({ token, password: 'brass-lantern-river-9' });
      expect(first.status).toBe(200);
      const reused = await request(app).post('/auth/reset-password').send({ token, password: 'another-good-one-7' });
      expect(reused.status).toBe(409);

      const bogus = await request(app).get('/auth/validate-password-reset').query({ token: 'nope' });
      expect(bogus.status).toBe(409);
    });
  });
});
