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
