import { google } from 'googleapis';
import type { Kysely } from 'kysely';
import { AUDIT, ERR } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import { AuthError, BusinessRuleError } from '../../lib/errors.js';
import { config } from '../../config.js';
import { record as auditRecord } from '../audit/auditService.js';
import { sendEmail, socialAccountLinkedEmail } from '../notifications/emailService.js';
import { completeSignIn, type LoginResult, type ReqMeta } from './authService.js';
import { signSetupPurposeToken, verifySetupPurposeToken } from './tokenService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

// Google/Microsoft sign-in — account LINKING, not self-registration. Spec:
// docs/specs/2026-11-17-auth-email-lifecycle-and-social-login-design.md
//
// A login is always made by an admin first; a provider's "sign in" only ever
// attaches to an existing row (by email, once) or signs in with one already
// attached (by provider id, every time after). It never creates one.

export type Provider = 'google' | 'microsoft';
const PROVIDER_LABEL: Record<Provider, 'Google' | 'Microsoft'> = { google: 'Google', microsoft: 'Microsoft' };
const PROVIDER_COLUMN = { google: 'google_id', microsoft: 'microsoft_id' } as const;

export function providerConfigured(provider: Provider): boolean {
  return provider === 'google'
    ? Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET)
    : Boolean(config.MICROSOFT_CLIENT_ID && config.MICROSOFT_CLIENT_SECRET);
}

function googleClient() {
  const callbackUrl = config.GOOGLE_CALLBACK_URL ?? `${config.APP_PUBLIC_URL.replace(/\/$/, '')}/auth/google/callback`;
  return new google.auth.OAuth2(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET, callbackUrl);
}

const OAUTH_STATE_PURPOSE = 'oauth_signin';

/** The URL to send the browser to for the provider's consent page. A signed,
 * 10-minute state round-trips through the provider so the callback can tell
 * a real attempt from a stale or forged one — same idea as Gmail's connect
 * state (tokenService.signGmailConnectState). `linkingUserId` is set only for
 * "Connect Google/Microsoft" from My account — the callback then links to
 * that login specifically, instead of running the sign-in lookup. */
export function authUrl(provider: Provider, linkingUserId?: string): string {
  const state = signSetupPurposeToken(OAUTH_STATE_PURPOSE, linkingUserId);
  if (provider === 'google') {
    return googleClient().generateAuthUrl({ scope: ['openid', 'email', 'profile'], state, prompt: 'consent' });
  }
  const callbackUrl = config.MICROSOFT_CALLBACK_URL ?? `${config.APP_PUBLIC_URL.replace(/\/$/, '')}/auth/microsoft/callback`;
  const params = new URLSearchParams({
    client_id: config.MICROSOFT_CLIENT_ID ?? '',
    response_type: 'code',
    redirect_uri: callbackUrl,
    response_mode: 'query',
    scope: 'openid email profile User.Read',
    state,
  });
  return `https://login.microsoftonline.com/${config.MICROSOFT_TENANT_ID}/oauth2/v2.0/authorize?${params.toString()}`;
}

/** Who to link to, if this state came from "Connect ..." on My account — null for a plain sign-in attempt. */
export function stateLinkingUserId(state: string | undefined): string | null | undefined {
  const verified = verifySetupPurposeToken(OAUTH_STATE_PURPOSE, state);
  return verified === null ? undefined : verified.user_id;
}

export type ProviderProfile = { providerId: string; email: string; name: string; avatarUrl: string | null };

async function googleProfile(code: string): Promise<ProviderProfile> {
  const auth = googleClient();
  const { tokens } = await auth.getToken(code);
  auth.setCredentials(tokens);
  const { data } = await google.oauth2('v2').userinfo.get({ auth });
  if (!data.id || !data.email) throw new BusinessRuleError(ERR.VALIDATION_FAILED, 'Google did not return an email address.');
  return { providerId: data.id, email: data.email, name: data.name ?? data.email, avatarUrl: data.picture ?? null };
}

async function microsoftProfile(code: string): Promise<ProviderProfile> {
  const callbackUrl = config.MICROSOFT_CALLBACK_URL ?? `${config.APP_PUBLIC_URL.replace(/\/$/, '')}/auth/microsoft/callback`;
  const tokenRes = await fetch(`https://login.microsoftonline.com/${config.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.MICROSOFT_CLIENT_ID ?? '',
      client_secret: config.MICROSOFT_CLIENT_SECRET ?? '',
      code,
      grant_type: 'authorization_code',
      redirect_uri: callbackUrl,
      scope: 'openid email profile User.Read',
    }),
  });
  if (!tokenRes.ok) throw new BusinessRuleError(ERR.VALIDATION_FAILED, 'Microsoft refused the sign-in code.');
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  const profileRes = await fetch('https://graph.microsoft.com/v1.0/me', { headers: { Authorization: `Bearer ${access_token}` } });
  if (!profileRes.ok) throw new BusinessRuleError(ERR.VALIDATION_FAILED, 'Could not read your Microsoft profile.');
  const profile = (await profileRes.json()) as { id: string; mail: string | null; userPrincipalName: string; displayName: string };
  const email = profile.mail ?? profile.userPrincipalName;
  if (!email) throw new BusinessRuleError(ERR.VALIDATION_FAILED, 'Microsoft did not return an email address.');
  return { providerId: profile.id, email, name: profile.displayName ?? email, avatarUrl: null };
}

function ctxFor(user: { id: string; firm_id: string; role: ServiceCtx['effective_role'] }, meta: ReqMeta): ServiceCtx {
  return { user_id: user.id, firm_id: user.firm_id, business_id: null, effective_role: user.role, ...meta };
}

/**
 * Either sign in (provider id already linked) or link-and-sign-in (a login
 * exists for that email, not yet linked) from an already-resolved provider
 * profile. Never creates a login — spec's whole point of "admins create
 * accounts, not sign-in buttons." Split out from completeOAuthSignIn so the
 * DB/linking logic is testable without a real network round trip to Google
 * or Microsoft — tests call this directly with a fake profile.
 */
export async function signInWithProfile(db: Kysely<DB>, provider: Provider, profile: ProviderProfile, meta: ReqMeta): Promise<LoginResult> {
  const column = PROVIDER_COLUMN[provider];

  let user = await db.selectFrom('users').selectAll().where(column, '=', profile.providerId).where('deleted_at', 'is', null).executeTakeFirst();
  let justLinked = false;

  if (!user) {
    const byEmail = await db.selectFrom('users').selectAll().where('email', '=', profile.email).where('deleted_at', 'is', null).executeTakeFirst();
    if (!byEmail) {
      throw new BusinessRuleError(ERR.NOT_FOUND, `No account found for ${profile.email}. Contact your administrator to get access.`);
    }
    try {
      await db.transaction().execute(async (trx) => {
        const updated = await trx.updateTable('users')
          .set({ [column]: profile.providerId, email_verified: true, avatar_url: profile.avatarUrl ?? byEmail.avatar_url })
          .where('id', '=', byEmail.id).where(column, 'is', null)
          .returning('id').executeTakeFirst();
        // A concurrent link (or a stale double-click) landed first — just sign in with what's there.
        if (!updated) return;
        await auditRecord(trx, ctxFor(byEmail, meta), {
          action: AUDIT.AUTH_SOCIAL_LINK, entity_type: 'user', entity_id: byEmail.id, before: null, after: { provider },
        });
      });
    } catch (e: unknown) {
      // Postgres unique_violation on the partial unique index: this provider
      // id is already linked to someone else entirely.
      if (e && typeof e === 'object' && 'code' in e && e.code === '23505') {
        throw new BusinessRuleError(ERR.DUPLICATE_RESOURCE, `This ${PROVIDER_LABEL[provider]} account is already linked to another user.`);
      }
      throw e;
    }
    user = { ...byEmail, [column]: profile.providerId, email_verified: true };
    justLinked = true;
  }

  if (user.deactivated_at) throw new AuthError(ERR.FORBIDDEN, 'This login has been switched off. Ask a firm admin.');
  if (justLinked) await sendEmail(socialAccountLinkedEmail({ to: user.email, provider: PROVIDER_LABEL[provider] }));
  return completeSignIn(db, user, meta);
}

/** The provider redirected back with a code — resolves it to a profile and signs in. */
export async function completeOAuthSignIn(db: Kysely<DB>, provider: Provider, code: string, meta: ReqMeta): Promise<LoginResult> {
  const profile = provider === 'google' ? await googleProfile(code) : await microsoftProfile(code);
  return signInWithProfile(db, provider, profile, meta);
}

/** From My account, already signed in: attach a provider to THIS login, from an already-resolved profile. */
export async function linkProfileToUser(db: Kysely<DB>, ctx: ServiceCtx, provider: Provider, profile: ProviderProfile): Promise<void> {
  const column = PROVIDER_COLUMN[provider];

  const conflict = await db.selectFrom('users').select('id').where(column, '=', profile.providerId).where('id', '<>', ctx.user_id).executeTakeFirst();
  if (conflict) throw new BusinessRuleError(ERR.DUPLICATE_RESOURCE, `This ${PROVIDER_LABEL[provider]} account is already linked to another user.`);

  await db.transaction().execute(async (trx) => {
    const before = await trx.selectFrom('users').select('avatar_url').where('id', '=', ctx.user_id).executeTakeFirstOrThrow();
    await trx.updateTable('users').set({ [column]: profile.providerId, avatar_url: profile.avatarUrl ?? before.avatar_url })
      .where('id', '=', ctx.user_id).execute();
    await auditRecord(trx, ctx, { action: AUDIT.AUTH_SOCIAL_LINK, entity_type: 'user', entity_id: ctx.user_id, before: null, after: { provider } });
  });
  const user = await db.selectFrom('users').select('email').where('id', '=', ctx.user_id).executeTakeFirstOrThrow();
  await sendEmail(socialAccountLinkedEmail({ to: user.email, provider: PROVIDER_LABEL[provider] }));
}

/** From My account: the full round trip, for the callback route. */
export async function linkSocialAccount(db: Kysely<DB>, ctx: ServiceCtx, provider: Provider, code: string): Promise<void> {
  const profile = provider === 'google' ? await googleProfile(code) : await microsoftProfile(code);
  return linkProfileToUser(db, ctx, provider, profile);
}

// Every login here always has a password_hash (an admin sets one even before
// the person ever signs in) — there is no "no password yet" state in this
// app's data model, so unlinking a social account can never lock anyone out.
// Nothing further to check before doing it.
export async function unlinkSocialAccount(db: Kysely<DB>, ctx: ServiceCtx, provider: Provider): Promise<void> {
  const user = await db.selectFrom('users').select(PROVIDER_COLUMN[provider]).where('id', '=', ctx.user_id).executeTakeFirstOrThrow();
  const column = PROVIDER_COLUMN[provider];
  if (!user[column]) return;
  await db.transaction().execute(async (trx) => {
    await trx.updateTable('users').set({ [column]: null }).where('id', '=', ctx.user_id).execute();
    await auditRecord(trx, ctx, { action: AUDIT.AUTH_SOCIAL_UNLINK, entity_type: 'user', entity_id: ctx.user_id, before: null, after: { provider } });
  });
}
