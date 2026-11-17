// Google/Microsoft sign-in — account linking, never self-registration.
// The provider round trip itself (code -> tokens -> profile) isn't under
// test here: signInWithProfile/linkProfileToUser take an already-resolved
// profile, exactly what completeOAuthSignIn/linkSocialAccount feed them
// after talking to the real provider. Spec:
// docs/specs/2026-11-17-auth-email-lifecycle-and-social-login-design.md
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeUser } from '../helpers/factories.js';
import { signInWithProfile, linkProfileToUser, unlinkSocialAccount, type ProviderProfile } from '../../src/services/auth/socialAuthService.js';
import { systemCtx } from '../../src/lib/ctx.js';
import { AuthError } from '../../src/lib/errors.js';

const reqMeta = { request_id: '00000000-0000-0000-0000-0000000000aa', ip_address: '127.0.0.1', user_agent: 'vitest' };
const profile = (overrides: Partial<ProviderProfile> = {}): ProviderProfile =>
  ({ providerId: 'g-12345', email: 'a@x.com', name: 'A Name', avatarUrl: null, ...overrides });

describe('social sign-in (account linking)', () => {
  let t: TestDb;
  let firmId: string;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); firmId = (await makeFirm(t.db)).id; });

  describe('signInWithProfile (the sign-in button)', () => {
    it('refuses an email with no matching login — never creates one', async () => {
      await expect(signInWithProfile(t.db, 'google', profile({ email: 'nobody@x.com' }), reqMeta))
        .rejects.toMatchObject({ message: expect.stringContaining('No account found for nobody@x.com') as unknown });
      expect(await t.db.selectFrom('users').select('id').where('email', '=', 'nobody@x.com').executeTakeFirst()).toBeUndefined();
    });

    it('links on first sign-in by email, verifies the email, and emails a one-time notice', async () => {
      const user = await makeUser(t.db, firmId, { email: 'a@x.com' });
      await t.db.updateTable('users').set({ email_verified: false }).where('id', '=', user.id).execute();
      const spy = vi.spyOn(console, 'log');

      const out = await signInWithProfile(t.db, 'google', profile(), reqMeta);
      expect(out.user.id).toBe(user.id);
      expect(out.access_token).toBeTruthy();
      expect(spy.mock.calls.map(c => String(c[0])).some(s => s.includes('[email]') && s.includes('to=a@x.com') && s.includes('Google account has been linked'))).toBe(true);
      spy.mockRestore();

      const row = await t.db.selectFrom('users').select(['google_id', 'email_verified']).where('id', '=', user.id).executeTakeFirstOrThrow();
      expect(row.google_id).toBe('g-12345');
      expect(row.email_verified).toBe(true);
    });

    it('signs in by provider id on later visits, without touching email lookup again', async () => {
      const user = await makeUser(t.db, firmId, { email: 'a@x.com' });
      await t.db.updateTable('users').set({ google_id: 'g-12345' }).where('id', '=', user.id).execute();
      const spy = vi.spyOn(console, 'log');

      const out = await signInWithProfile(t.db, 'google', profile({ email: 'a-changed-their-email@elsewhere.com' }), reqMeta);
      expect(out.user.id).toBe(user.id);
      // Already linked: no "linked" email the second time.
      expect(spy.mock.calls.map(c => String(c[0])).some(s => s.includes('has been linked'))).toBe(false);
      spy.mockRestore();
    });

    it('refuses a deactivated login, even with a valid linked provider id', async () => {
      const user = await makeUser(t.db, firmId, { email: 'a@x.com' });
      await t.db.updateTable('users').set({ google_id: 'g-12345', deactivated_at: new Date().toISOString() as unknown as string }).where('id', '=', user.id).execute();
      await expect(signInWithProfile(t.db, 'google', profile(), reqMeta)).rejects.toBeInstanceOf(AuthError);
    });
  });

  describe('linkProfileToUser ("Connect Google" from My account)', () => {
    it('attaches the provider id to the signed-in user and emails a notice', async () => {
      const user = await makeUser(t.db, firmId, { email: 'a@x.com' });
      const ctx = systemCtx({ firm_id: firmId, user_id: user.id });
      const spy = vi.spyOn(console, 'log');

      await linkProfileToUser(t.db, ctx, 'microsoft', profile({ providerId: 'm-999' }));
      expect(spy.mock.calls.map(c => String(c[0])).some(s => s.includes('Microsoft account has been linked'))).toBe(true);
      spy.mockRestore();

      const row = await t.db.selectFrom('users').select('microsoft_id').where('id', '=', user.id).executeTakeFirstOrThrow();
      expect(row.microsoft_id).toBe('m-999');
    });

    it('refuses when that provider id already belongs to someone else', async () => {
      const other = await makeUser(t.db, firmId, { email: 'other@x.com' });
      await t.db.updateTable('users').set({ google_id: 'g-taken' }).where('id', '=', other.id).execute();
      const me = await makeUser(t.db, firmId, { email: 'me@x.com' });
      const ctx = systemCtx({ firm_id: firmId, user_id: me.id });

      await expect(linkProfileToUser(t.db, ctx, 'google', profile({ providerId: 'g-taken' })))
        .rejects.toMatchObject({ message: expect.stringContaining('already linked to another user') as unknown });
    });
  });

  describe('unlinkSocialAccount', () => {
    it('removes the link and is a no-op if nothing was linked', async () => {
      const user = await makeUser(t.db, firmId, { email: 'a@x.com' });
      await t.db.updateTable('users').set({ google_id: 'g-12345' }).where('id', '=', user.id).execute();
      const ctx = systemCtx({ firm_id: firmId, user_id: user.id });

      await unlinkSocialAccount(t.db, ctx, 'google');
      expect((await t.db.selectFrom('users').select('google_id').where('id', '=', user.id).executeTakeFirstOrThrow()).google_id).toBeNull();

      await expect(unlinkSocialAccount(t.db, ctx, 'google')).resolves.toBeUndefined();
    });
  });
});
