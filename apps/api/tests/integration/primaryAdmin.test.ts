// Multiple firm admins, with one designated Primary Admin who can't be
// demoted/deactivated/deleted except by transferring the designation first.
// Spec: docs/specs/2026-11-15-user-invitations-and-signin-design.md
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeUser } from '../helpers/factories.js';
import { makeApp } from '../../src/app.js';
import { destroyDbSingleton } from '../../src/db/index.js';
import { systemCtx } from '../../src/lib/ctx.js';
import { deactivateUser, deleteUser, updateUserRole } from '../../src/services/admin/userManagementService.js';

const PASSWORD = 'first-password-1';

describe('primary admin transfer', () => {
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
    delete: (url: string) => request(app).delete(url).set('Authorization', `Bearer ${s.token}`).set('Cookie', s.cookie),
  });

  async function makePrimaryAdmin(email: string, full_name = 'Primary Admin') {
    const user = await makeUser(t.db, firmId, { email, password: PASSWORD, role: 'firm_admin', full_name });
    await t.db.updateTable('firms').set({ primary_admin_user_id: user.id }).where('id', '=', firmId).execute();
    return user;
  }

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

  describe('initiating and cancelling', () => {
    it('lets the Primary Admin start a transfer, and a second firm admin see it pending', async () => {
      const primary = await makePrimaryAdmin('primary@x.com');
      const target = await makeUser(t.db, firmId, { email: 'target@x.com', password: PASSWORD, role: 'firm_admin', full_name: 'Target Admin' });
      const primarySession = await signIn('primary@x.com');
      const otherSession = await signIn('target@x.com');

      const getLink = captureLink();
      const started = await as(primarySession).post('/me/firm/transfer-primary-admin', { target_user_id: target.id });
      expect(started.status).toBe(200);
      expect(started.body).toEqual({ ok: true, target_email: 'target@x.com', email_sent: false });
      const token = tokenFromLink(getLink());

      const status = await as(otherSession).get('/me/firm/transfer-status');
      expect(status.status).toBe(200);
      expect(status.body).toEqual({ pending: true, target_user_id: target.id, target_name: 'Target Admin', target_email: 'target@x.com' });

      const validate = await request(app).get('/auth/validate-primary-admin-transfer').query({ token });
      expect(validate.status).toBe(200);
      expect(validate.body).toEqual({ firm_name: 'Acme Bookkeeping', current_admin_name: 'Primary Admin', target_email: 'target@x.com' });

      void primary;
    });

    it('refuses a non-primary-admin, a second pending transfer, a non-admin target, and the primary targeting themselves', async () => {
      const primary = await makePrimaryAdmin('primary@x.com');
      const other = await makeUser(t.db, firmId, { email: 'other@x.com', password: PASSWORD, role: 'firm_admin' });
      const target = await makeUser(t.db, firmId, { email: 'target@x.com', password: PASSWORD, role: 'firm_admin' });
      const staff = await makeUser(t.db, firmId, { email: 'staff@x.com', password: PASSWORD, role: 'staff' });
      const primarySession = await signIn('primary@x.com');
      const otherSession = await signIn('other@x.com');

      const notPrimary = await as(otherSession).post('/me/firm/transfer-primary-admin', { target_user_id: target.id });
      expect(notPrimary.status).toBe(403);

      const toSelf = await as(primarySession).post('/me/firm/transfer-primary-admin', { target_user_id: primary.id });
      expect(toSelf.status).toBe(400);

      const toStaff = await as(primarySession).post('/me/firm/transfer-primary-admin', { target_user_id: staff.id });
      expect(toStaff.status).toBe(400);

      const first = await as(primarySession).post('/me/firm/transfer-primary-admin', { target_user_id: target.id });
      expect(first.status).toBe(200);
      const again = await as(primarySession).post('/me/firm/transfer-primary-admin', { target_user_id: other.id });
      expect(again.status).toBe(409);
    });

    it('lets the Primary Admin cancel a pending transfer, and refuses a second firm admin that', async () => {
      const primary = await makePrimaryAdmin('primary@x.com');
      const target = await makeUser(t.db, firmId, { email: 'target@x.com', password: PASSWORD, role: 'firm_admin' });
      await makeUser(t.db, firmId, { email: 'other@x.com', password: PASSWORD, role: 'firm_admin' });
      const primarySession = await signIn('primary@x.com');
      const otherSession = await signIn('other@x.com');
      void primary;

      await as(primarySession).post('/me/firm/transfer-primary-admin', { target_user_id: target.id });

      const refused = await as(otherSession).delete('/me/firm/transfer-primary-admin');
      expect(refused.status).toBe(403);

      const cancelled = await as(primarySession).delete('/me/firm/transfer-primary-admin');
      expect(cancelled.status).toBe(200);
      expect(cancelled.body).toEqual({ ok: true });

      const status = await as(primarySession).get('/me/firm/transfer-status');
      expect(status.body).toEqual({ pending: false });
    });
  });

  describe('accepting and declining', () => {
    it('makes the target the new Primary Admin on accept, keeping the old one a plain firm admin', async () => {
      const primary = await makePrimaryAdmin('primary@x.com');
      const target = await makeUser(t.db, firmId, { email: 'target@x.com', password: PASSWORD, role: 'firm_admin' });
      const primarySession = await signIn('primary@x.com');

      const getLink = captureLink();
      await as(primarySession).post('/me/firm/transfer-primary-admin', { target_user_id: target.id });
      const token = tokenFromLink(getLink());

      const accepted = await request(app).post('/auth/accept-primary-admin').send({ token });
      expect(accepted.status).toBe(200);

      const firm = await t.db.selectFrom('firms').select(['primary_admin_user_id', 'transfer_target_user_id', 'transfer_token_hash'])
        .where('id', '=', firmId).executeTakeFirstOrThrow();
      expect(firm.primary_admin_user_id).toBe(target.id);
      expect(firm.transfer_target_user_id).toBeNull();
      expect(firm.transfer_token_hash).toBeNull();

      // The old primary admin keeps their firm_admin role and access — only demotable now.
      const oldRow = await t.db.selectFrom('users').select('role').where('id', '=', primary.id).executeTakeFirstOrThrow();
      expect(oldRow.role).toBe('firm_admin');

      // Using the same token again is refused — it's single-use.
      const reused = await request(app).post('/auth/accept-primary-admin').send({ token });
      expect(reused.status).toBe(409);
    });

    it('changes nothing on decline, and the link stops working either way', async () => {
      const primary = await makePrimaryAdmin('primary@x.com');
      const target = await makeUser(t.db, firmId, { email: 'target@x.com', password: PASSWORD, role: 'firm_admin' });
      const primarySession = await signIn('primary@x.com');

      const getLink = captureLink();
      await as(primarySession).post('/me/firm/transfer-primary-admin', { target_user_id: target.id });
      const token = tokenFromLink(getLink());

      const declined = await request(app).post('/auth/decline-primary-admin').send({ token });
      expect(declined.status).toBe(200);

      const firm = await t.db.selectFrom('firms').select('primary_admin_user_id').where('id', '=', firmId).executeTakeFirstOrThrow();
      expect(firm.primary_admin_user_id).toBe(primary.id);

      const reused = await request(app).post('/auth/decline-primary-admin').send({ token });
      expect(reused.status).toBe(409);
    });

    it('refuses an expired transfer link', async () => {
      await makePrimaryAdmin('primary@x.com');
      const target = await makeUser(t.db, firmId, { email: 'target@x.com', password: PASSWORD, role: 'firm_admin' });
      const primarySession = await signIn('primary@x.com');

      const getLink = captureLink();
      await as(primarySession).post('/me/firm/transfer-primary-admin', { target_user_id: target.id });
      const token = tokenFromLink(getLink());
      await t.db.updateTable('firms').set({ transfer_expires_at: new Date(Date.now() - 1000).toISOString() as unknown as string })
        .where('id', '=', firmId).execute();

      const validate = await request(app).get('/auth/validate-primary-admin-transfer').query({ token });
      expect(validate.status).toBe(409);
      const accepted = await request(app).post('/auth/accept-primary-admin').send({ token });
      expect(accepted.status).toBe(409);
    });
  });

  describe('the Primary Admin cannot be changed through the ordinary user actions', () => {
    it('refuses to change their role, deactivate, or delete them, called directly', async () => {
      const primary = await makePrimaryAdmin('primary@x.com');
      await makeUser(t.db, firmId, { email: 'other@x.com', role: 'firm_admin' }); // a second admin, so "only admin" guards don't also fire
      const ctx = systemCtx({ firm_id: firmId });

      await expect(
        t.db.transaction().execute(trx => updateUserRole(trx, ctx, { user_id: primary.id, role: 'accountant' })),
      ).rejects.toMatchObject({ message: expect.stringContaining('Transfer the role first') as unknown });

      await expect(
        t.db.transaction().execute(trx => deactivateUser(trx, ctx, { user_id: primary.id })),
      ).rejects.toMatchObject({ message: expect.stringContaining('Transfer the role first') as unknown });

      await expect(
        t.db.transaction().execute(trx => deleteUser(trx, ctx, { user_id: primary.id })),
      ).rejects.toMatchObject({ message: expect.stringContaining('Transfer the role first') as unknown });
    });

    it('lets any other firm admin be changed normally', async () => {
      await makePrimaryAdmin('primary@x.com');
      const other = await makeUser(t.db, firmId, { email: 'other@x.com', role: 'firm_admin' });
      const ctx = systemCtx({ firm_id: firmId });

      const updated = await t.db.transaction().execute(trx => updateUserRole(trx, ctx, { user_id: other.id, role: 'accountant' }));
      expect(updated.role).toBe('accountant');
    });
  });

  describe('GET /me/firm/users', () => {
    it('flags the primary admin row', async () => {
      const primary = await makePrimaryAdmin('primary@x.com');
      const other = await makeUser(t.db, firmId, { email: 'other@x.com', password: PASSWORD, role: 'firm_admin' });
      const session = await signIn('primary@x.com');

      const list = await as(session).get('/me/firm/users');
      const users = list.body.users as Array<{ id: string; is_primary_admin: boolean }>;
      expect(users.find(u => u.id === primary.id)?.is_primary_admin).toBe(true);
      expect(users.find(u => u.id === other.id)?.is_primary_admin).toBe(false);
    });
  });
});
