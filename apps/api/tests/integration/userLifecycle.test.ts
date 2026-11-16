// Editing a login's name, and deleting one that was never actually used — the
// two Setup → Users actions added alongside the action-menu redesign (11-16).
// Spec: docs/specs/2026-11-15-user-invitations-and-signin-design.md
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, grantAccess } from '../helpers/factories.js';
import { makeApp } from '../../src/app.js';
import { destroyDbSingleton } from '../../src/db/index.js';
import { systemCtx } from '../../src/lib/ctx.js';
import { updateUserRole } from '../../src/services/admin/userManagementService.js';

const PASSWORD = 'first-password-1';

describe('editing and deleting a login', () => {
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
    firmId = (await makeFirm(t.db)).id;
  });

  type Session = { token: string; cookie: string; status: number; body: Record<string, unknown> };
  async function signIn(email: string, password = PASSWORD): Promise<Session> {
    const res = await request(app).post('/auth/login').send({ email, password });
    const cookie = (res.headers['set-cookie'] as unknown as string[] | undefined)?.[0]?.split(';')[0] ?? '';
    return { token: res.body.access_token as string, cookie, status: res.status, body: res.body };
  }
  const as = (s: Session) => ({
    post: (url: string, body: object = {}) => request(app).post(url).set('Authorization', `Bearer ${s.token}`).set('Cookie', s.cookie).send(body),
    patch: (url: string, body: object = {}) => request(app).patch(url).set('Authorization', `Bearer ${s.token}`).set('Cookie', s.cookie).send(body),
    delete: (url: string) => request(app).delete(url).set('Authorization', `Bearer ${s.token}`).set('Cookie', s.cookie),
    get: (url: string) => request(app).get(url).set('Authorization', `Bearer ${s.token}`).set('Cookie', s.cookie),
  });

  describe('PATCH /me/firm/users/:id (role)', () => {
    it("refuses to move the firm's only firm admin to any other role", async () => {
      const admin = await makeUser(t.db, firmId, { email: 'admin@x.com', password: PASSWORD, role: 'firm_admin' });
      const session = await signIn('admin@x.com');

      // Someone else may change it — the one admin can't be moved off the
      // role through themselves, but another firm admin can't be the one
      // blocked either; only "no admin left" is refused.
      const r = await as(session).patch(`/me/firm/users/${admin.id}`, { role: 'accountant' });
      expect(r.status).toBe(403); // "Cannot change your own role" fires first
      expect(r.body.error.message).toMatch(/own role/);
    });

    // The only way to a genuinely "someone else demotes the sole firm admin"
    // state is through the route's own, earlier "cannot change your own role"
    // guard — the service's check below is defense in depth behind it, the
    // same structural shape deactivateUser's and deleteUser's own "only firm
    // admin" guards already have. Exercised directly, as those are elsewhere.
    it('the service guard itself refuses moving the only firm admin off the role, called directly', async () => {
      const admin = await makeUser(t.db, firmId, { email: 'admin@x.com', role: 'firm_admin' });
      const ctx = systemCtx({ firm_id: firmId });

      await expect(
        t.db.transaction().execute(trx => updateUserRole(trx, ctx, { user_id: admin.id, role: 'accountant' })),
      ).rejects.toMatchObject({ message: expect.stringContaining('is the only firm admin') as unknown });

      // Once a second firm admin exists, moving the first off the role is fine.
      await makeUser(t.db, firmId, { email: 'second@x.com', role: 'firm_admin' });
      const updated = await t.db.transaction().execute(trx => updateUserRole(trx, ctx, { user_id: admin.id, role: 'accountant' }));
      expect(updated.role).toBe('accountant');
    });

    it('allows a firm admin to demote a second one while they are not the only one left', async () => {
      await makeUser(t.db, firmId, { email: 'first@x.com', password: PASSWORD, role: 'firm_admin' });
      const second = await makeUser(t.db, firmId, { email: 'second@x.com', password: PASSWORD, role: 'firm_admin' });
      const firstSession = await signIn('first@x.com');

      const demoted = await as(firstSession).patch(`/me/firm/users/${second.id}`, { role: 'accountant' });
      expect(demoted.status).toBe(200);
    });
  });

  describe('PATCH /me/firm/users/:id/profile', () => {
    it('renames a login, and the admin need not be a firm admin for their own account', async () => {
      await makeUser(t.db, firmId, { email: 'admin@x.com', password: PASSWORD, role: 'firm_admin' });
      const pat = await makeUser(t.db, firmId, { email: 'pat@x.com', password: PASSWORD, role: 'accountant', full_name: 'Pat Lee' });
      const admin = await signIn('admin@x.com');

      const r = await as(admin).patch(`/me/firm/users/${pat.id}/profile`, { full_name: 'Patricia Lee' });
      expect(r.status).toBe(200);
      expect(r.body.full_name).toBe('Patricia Lee');
      expect((await t.db.selectFrom('users').select('full_name').where('id', '=', pat.id).executeTakeFirstOrThrow()).full_name).toBe('Patricia Lee');
    });

    it('refuses an empty name, and is firm-admin only', async () => {
      await makeUser(t.db, firmId, { email: 'admin@x.com', password: PASSWORD, role: 'firm_admin' });
      const pat = await makeUser(t.db, firmId, { email: 'pat@x.com', password: PASSWORD, role: 'accountant' });
      const admin = await signIn('admin@x.com');
      const other = await signIn('pat@x.com');

      expect((await as(admin).patch(`/me/firm/users/${pat.id}/profile`, { full_name: '  ' })).status).toBe(400);
      expect((await as(other).patch(`/me/firm/users/${pat.id}/profile`, { full_name: 'Someone Else' })).status).toBe(403);
    });
  });

  describe('PATCH /me/firm/users/:id/business-access/:businessId', () => {
    it("changes an existing grant's role, without a revoke-then-grant round trip", async () => {
      await makeUser(t.db, firmId, { email: 'admin@x.com', password: PASSWORD, role: 'firm_admin' });
      const biz = await makeBusiness(t.db, firmId, 'Biz');
      const pat = await makeUser(t.db, firmId, { email: 'pat@x.com', password: PASSWORD, role: 'staff' });
      await grantAccess(t.db, pat.id, biz.id, 'staff');
      const admin = await signIn('admin@x.com');

      const r = await as(admin).patch(`/me/firm/users/${pat.id}/business-access/${biz.id}`, { role_override: 'accountant' });
      expect(r.status).toBe(200);
      expect(r.body.role_override).toBe('accountant');

      const row = await t.db.selectFrom('user_business_access').select(['role_override', 'custom_role_id'])
        .where('user_id', '=', pat.id).where('business_id', '=', biz.id).executeTakeFirstOrThrow();
      expect(row.role_override).toBe('accountant');
      expect(row.custom_role_id).toBeNull();
    });

    it('refuses a business that was never granted, and both a role and a custom role at once', async () => {
      await makeUser(t.db, firmId, { email: 'admin@x.com', password: PASSWORD, role: 'firm_admin' });
      const biz = await makeBusiness(t.db, firmId, 'Biz');
      const pat = await makeUser(t.db, firmId, { email: 'pat@x.com', password: PASSWORD, role: 'staff' });
      const admin = await signIn('admin@x.com');

      const neverGranted = await as(admin).patch(`/me/firm/users/${pat.id}/business-access/${biz.id}`, { role_override: 'accountant' });
      expect(neverGranted.status).toBe(404);

      await grantAccess(t.db, pat.id, biz.id);
      const both = await as(admin).patch(`/me/firm/users/${pat.id}/business-access/${biz.id}`, { role_override: 'accountant', custom_role_id: '11111111-1111-1111-1111-111111111111' });
      expect(both.status).toBe(400);
    });
  });

  describe('DELETE /me/firm/users/:id', () => {
    it('deletes a login that was never used', async () => {
      await makeUser(t.db, firmId, { email: 'admin@x.com', password: PASSWORD, role: 'firm_admin' });
      const sam = await makeUser(t.db, firmId, { email: 'sam@x.com', password: PASSWORD, role: 'staff' });
      const admin = await signIn('admin@x.com');

      const r = await as(admin).delete(`/me/firm/users/${sam.id}`);
      expect(r.status).toBe(204);
      expect(await t.db.selectFrom('users').select('id').where('id', '=', sam.id).where('deleted_at', 'is', null).executeTakeFirst()).toBeUndefined();
      expect((await as(admin).get('/me/firm/users')).body.users.find((u: { id: string }) => u.id === sam.id)).toBeUndefined();
    });

    it('deletes a login made through Add user (and even deactivated) that was itself never touched', async () => {
      // Through the real route, not the factory: creating and deactivating a
      // login write audit rows ABOUT it (entity_id = its id), with the admin
      // as the actor (user_id = the admin's id) — that must not count as
      // this login's own footprint, or nothing created through "Add user"
      // could ever be deleted again.
      await makeUser(t.db, firmId, { email: 'admin@x.com', password: PASSWORD, role: 'firm_admin' });
      const admin = await signIn('admin@x.com');
      const created = await as(admin).post('/me/firm/users', { email: 'sam@x.com', full_name: 'Sam Ortiz', role: 'staff' });
      const samId = (created.body.user as { id: string }).id;

      await as(admin).post(`/me/firm/users/${samId}/deactivate`);
      const r = await as(admin).delete(`/me/firm/users/${samId}`);
      expect(r.status).toBe(204);
    });

    it('refuses once the login has signed in, has business access, or has an audit trail', async () => {
      await makeUser(t.db, firmId, { email: 'admin@x.com', password: PASSWORD, role: 'firm_admin' });
      const biz = await makeBusiness(t.db, firmId, 'Biz');
      const everUsed = await makeUser(t.db, firmId, { email: 'used@x.com', password: PASSWORD, role: 'staff' });
      const granted = await makeUser(t.db, firmId, { email: 'granted@x.com', password: PASSWORD, role: 'staff' });
      await grantAccess(t.db, granted.id, biz.id);
      const admin = await signIn('admin@x.com');
      await signIn('used@x.com'); // gives this login a refresh token + an AUTH_LOGIN audit row

      const usedResult = await as(admin).delete(`/me/firm/users/${everUsed.id}`);
      expect(usedResult.status).toBe(409);
      expect(usedResult.body.error.message).toMatch(/Switch off/);

      const grantedResult = await as(admin).delete(`/me/firm/users/${granted.id}`);
      expect(grantedResult.status).toBe(409);

      // Neither was actually removed.
      expect(await t.db.selectFrom('users').select('id').where('id', '=', everUsed.id).executeTakeFirst()).not.toBeUndefined();
      expect(await t.db.selectFrom('users').select('id').where('id', '=', granted.id).executeTakeFirst()).not.toBeUndefined();
    });

    it('refuses to delete your own login, but lets a firm admin delete another one', async () => {
      const admin = await makeUser(t.db, firmId, { email: 'admin@x.com', password: PASSWORD, role: 'firm_admin' });
      const session = await signIn('admin@x.com');

      const self = await as(session).delete(`/me/firm/users/${admin.id}`);
      expect(self.status).toBe(409);
      expect(self.body.error.message).toMatch(/own login/);

      const second = await makeUser(t.db, firmId, { email: 'second@x.com', password: PASSWORD, role: 'firm_admin' });
      expect((await as(session).delete(`/me/firm/users/${second.id}`)).status).toBe(204);
    });
  });
});
