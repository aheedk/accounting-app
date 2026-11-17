// apps/api/tests/integration/authService.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, grantAccess } from '../helpers/factories.js';
import { login, refresh, logout } from '../../src/services/auth/authService.js';
import { AuthError } from '../../src/lib/errors.js';

const reqMeta = { request_id: '00000000-0000-0000-0000-0000000000aa', ip_address: '127.0.0.1', user_agent: 'vitest' };

describe('authService.login', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('issues access + refresh on valid creds, writes audit row', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id, 'Biz 1');
    const user = await makeUser(t.db, firm.id, { email: 'a@x.com', password: 'pw12345678' });
    await grantAccess(t.db, user.id, biz.id);
    const out = await login(t.db, { email: 'a@x.com', password: 'pw12345678' }, reqMeta);
    expect(out.access_token).toBeTruthy();
    expect(out.refresh_token).toBeTruthy();
    expect(out.user.id).toBe(user.id);
    expect(out.businesses).toHaveLength(1);
    const audits = await t.db.selectFrom('audit_logs').selectAll().execute();
    expect(audits.map(a => a.action)).toContain('auth.login');
  });

  it('rejects wrong password, writes auth.login_failed audit', async () => {
    const firm = await makeFirm(t.db);
    const user = await makeUser(t.db, firm.id, { email: 'a@x.com', password: 'pw12345678' });
    await expect(login(t.db, { email: 'a@x.com', password: 'wrongpass' }, reqMeta)).rejects.toBeInstanceOf(AuthError);
    const audits = await t.db.selectFrom('audit_logs').selectAll().execute();
    expect(audits.map(a => a.action)).toContain('auth.login_failed');
    void user;
  });

  it('refuses to sign in before the email is verified, even with the right password', async () => {
    const firm = await makeFirm(t.db);
    const user = await makeUser(t.db, firm.id, { email: 'a@x.com', password: 'pw12345678' });
    await t.db.updateTable('users').set({ email_verified: false }).where('id', '=', user.id).execute();
    await expect(login(t.db, { email: 'a@x.com', password: 'pw12345678' }, reqMeta))
      .rejects.toMatchObject({ message: expect.stringContaining('check your email to verify') as unknown });
  });

  it('rejects unknown email with same AuthError (no user enumeration)', async () => {
    const firm = await makeFirm(t.db);
    await makeUser(t.db, firm.id, { email: 'a@x.com', password: 'pw12345678' });
    await expect(login(t.db, { email: 'b@x.com', password: 'pw12345678' }, reqMeta)).rejects.toBeInstanceOf(AuthError);
  });

  it('refresh rotates the refresh token and revokes the old one', async () => {
    const firm = await makeFirm(t.db);
    const user = await makeUser(t.db, firm.id, { email: 'a@x.com', password: 'pw12345678' });
    void user;
    const first = await login(t.db, { email: 'a@x.com', password: 'pw12345678' }, reqMeta);
    const second = await refresh(t.db, first.refresh_token, reqMeta);
    expect(second.refresh_token).not.toBe(first.refresh_token);
    // Old token is now rejected
    await expect(refresh(t.db, first.refresh_token, reqMeta)).rejects.toBeInstanceOf(AuthError);
  });

  it('logout revokes the refresh token', async () => {
    const firm = await makeFirm(t.db);
    await makeUser(t.db, firm.id, { email: 'a@x.com', password: 'pw12345678' });
    const first = await login(t.db, { email: 'a@x.com', password: 'pw12345678' }, reqMeta);
    await logout(t.db, first.refresh_token, reqMeta);
    await expect(refresh(t.db, first.refresh_token, reqMeta)).rejects.toBeInstanceOf(AuthError);
  });

  it('does not alert on the very first sign-in, but does on a later one from a new device', async () => {
    const firm = await makeFirm(t.db);
    await makeUser(t.db, firm.id, { email: 'a@x.com', password: 'pw12345678' });
    const spy = vi.spyOn(console, 'log');

    await login(t.db, { email: 'a@x.com', password: 'pw12345678' }, reqMeta); // the very first sign-in
    expect(spy.mock.calls.map(c => String(c[0])).some(s => s.includes('[email]') && s.includes('New sign-in'))).toBe(false);
    expect(await t.db.selectFrom('user_devices').selectAll().execute()).toHaveLength(0);

    spy.mockClear();
    const elsewhere = { ...reqMeta, user_agent: 'a-totally-different-browser', ip_address: '203.0.113.9' };
    await login(t.db, { email: 'a@x.com', password: 'pw12345678' }, elsewhere);
    expect(spy.mock.calls.map(c => String(c[0])).some(s => s.includes('[email]') && s.includes('to=a@x.com') && s.includes('New sign-in'))).toBe(true);
    expect(await t.db.selectFrom('user_devices').selectAll().execute()).toHaveLength(1);

    // Signing in again from the SAME device does not alert a second time.
    spy.mockClear();
    await login(t.db, { email: 'a@x.com', password: 'pw12345678' }, elsewhere);
    expect(spy.mock.calls.map(c => String(c[0])).some(s => s.includes('New sign-in'))).toBe(false);
    expect(await t.db.selectFrom('user_devices').selectAll().execute()).toHaveLength(1);

    spy.mockRestore();
  });
});
