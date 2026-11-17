import { Router, type Request, type Response } from 'express';
import { ERR, schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { login, refresh, logout } from '../services/auth/authService.js';
import * as account from '../services/auth/accountService.js';
import { hashRefreshToken } from '../services/auth/tokenService.js';
import * as invitation from '../services/auth/invitationService.js';
import * as passwordReset from '../services/auth/passwordResetService.js';
import * as primaryAdminSvc from '../services/admin/primaryAdminService.js';
import * as social from '../services/auth/socialAuthService.js';
import { requireAuth } from '../middleware/auth.js';
import type { ServiceCtx } from '../lib/ctx.js';
import { config } from '../config.js';
import { AuthError } from '../lib/errors.js';
import { addressRefusal, clearSignInFailures, recordFailedSignIn } from '../lib/loginThrottle.js';

const router = Router();

function reqMeta(req: Request) {
  return {
    request_id: req.request_id,
    ip_address: req.ip ?? '0.0.0.0',
    user_agent: req.headers['user-agent'] ?? '',
  };
}

const REFRESH_COOKIE = 'acct_rt';

// The cookie lasts as long as the session may (the idle limit or the session
// limit, see authService), so the browser drops it when the API would refuse it.
function setRefreshCookie(res: Response, raw: string, expiresAt: Date) {
  res.cookie(REFRESH_COOKIE, raw, {
    httpOnly: true,
    secure: config.NODE_ENV !== 'development',
    sameSite: config.NODE_ENV === 'development' ? 'lax' : 'none',
    maxAge: Math.max(0, expiresAt.getTime() - Date.now()),
    path: '/auth',
  });
}

router.post('/auth/login', async (req, res, next) => {
  const address = req.ip ?? 'unknown';
  try {
    const refusal = addressRefusal(address);
    if (refusal) throw new AuthError(ERR.ACCOUNT_LOCKED, refusal);
    const body = schemas.loginRequestSchema.parse(req.body);
    const tokenType = body.client === 'mobile' ? 'mobile' : 'web';
    let out: Awaited<ReturnType<typeof login>>;
    try {
      out = await login(db, body, reqMeta(req), tokenType);
    } catch (e: unknown) {
      // A wrong password or code counts against the address; "a code is needed" does not.
      if (e instanceof AuthError && e.code === ERR.INVALID_CREDENTIALS) recordFailedSignIn(address);
      throw e;
    }
    clearSignInFailures(address);
    const { refresh_expires_at: expiresAt, ...withToken } = out;
    if (tokenType === 'mobile') {
      // No httpOnly cookie reaches a native client — hand the refresh token
      // back in the body instead; the mobile app is responsible for storing
      // it in SecureStore.
      res.json(withToken);
    } else {
      setRefreshCookie(res, out.refresh_token, expiresAt);
      const { refresh_token: _rt, ...publicOut } = withToken;
      void _rt;
      res.json(publicOut);
    }
  } catch (e) { next(e); }
});

// ── Invitation links, in place of an admin-typed password, and self-service
// password reset. Both are public: the person isn't signed in yet. Spec:
// docs/specs/2026-11-15-user-invitations-and-signin-design.md

router.get('/auth/validate-invitation', async (req, res, next) => {
  try {
    const { token } = schemas.tokenLookupSchema.parse(req.query);
    const lookup = await invitation.validateInvitationToken(db, token);
    res.json({ email: lookup.email, full_name: lookup.full_name, firm_name: lookup.firm_name });
  } catch (e) { next(e); }
});

router.post('/auth/accept-invitation', async (req, res, next) => {
  try {
    const body = schemas.acceptInvitationSchema.parse(req.body);
    const out = await invitation.acceptInvitation(db, body, reqMeta(req));
    const { refresh_expires_at: expiresAt, ...withToken } = out;
    setRefreshCookie(res, out.refresh_token, expiresAt);
    const { refresh_token: _rt, ...publicOut } = withToken;
    void _rt;
    res.json(publicOut);
  } catch (e) { next(e); }
});

router.post('/auth/forgot-password', async (req, res, next) => {
  try {
    const body = schemas.forgotPasswordSchema.parse(req.body);
    await passwordReset.requestPasswordReset(db, body, reqMeta(req));
    // Always the same response, whether or not the address has a login — see
    // requestPasswordReset's own note on not revealing which emails exist.
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.get('/auth/validate-password-reset', async (req, res, next) => {
  try {
    const { token } = schemas.tokenLookupSchema.parse(req.query);
    res.json(await passwordReset.validatePasswordResetToken(db, token));
  } catch (e) { next(e); }
});

router.post('/auth/reset-password', async (req, res, next) => {
  try {
    const body = schemas.resetPasswordSchema.parse(req.body);
    await passwordReset.completePasswordReset(db, body, reqMeta(req));
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ── Transferring the firm's Primary Admin designation — public, token-based,
// same shape as the invitation/reset links above. Spec:
// docs/specs/2026-11-15-user-invitations-and-signin-design.md

router.get('/auth/validate-primary-admin-transfer', async (req, res, next) => {
  try {
    const { token } = schemas.tokenLookupSchema.parse(req.query);
    const lookup = await primaryAdminSvc.validateTransferToken(db, token);
    res.json({ firm_name: lookup.firm_name, current_admin_name: lookup.current_admin_name, target_email: lookup.target_email });
  } catch (e) { next(e); }
});

router.post('/auth/accept-primary-admin', async (req, res, next) => {
  try {
    const body = schemas.primaryAdminTokenSchema.parse(req.body);
    await primaryAdminSvc.acceptTransfer(db, body, reqMeta(req));
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/auth/decline-primary-admin', async (req, res, next) => {
  try {
    const body = schemas.primaryAdminTokenSchema.parse(req.body);
    await primaryAdminSvc.declineTransfer(db, body, reqMeta(req));
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ── Social sign-in (Google/Microsoft) — account linking, never self-
// registration. Spec: docs/specs/2026-11-17-auth-email-lifecycle-and-social-login-design.md

// The login page asks this to decide which buttons to show at all, rather
// than offering one that would only fail once clicked.
router.get('/auth/social-providers', (_req, res) => {
  res.json({ google: social.providerConfigured('google'), microsoft: social.providerConfigured('microsoft') });
});

function startOAuth(provider: social.Provider) {
  return (_req: Request, res: Response) => {
    if (!social.providerConfigured(provider)) {
      res.redirect(`${config.APP_PUBLIC_URL}/login?oauth_error=${encodeURIComponent(`Sign-in with ${provider === 'google' ? 'Google' : 'Microsoft'} is not set up on this server.`)}`);
      return;
    }
    res.redirect(social.authUrl(provider));
  };
}
router.get('/auth/google', startOAuth('google'));
router.get('/auth/microsoft', startOAuth('microsoft'));

// "Connect Google/Microsoft" on My account: the same provider round trip,
// but starting from an already-signed-in person, so the callback links to
// them specifically instead of running the sign-in lookup.
router.get('/auth/:provider/connect', requireAuth, (req, res) => {
  const provider = req.params['provider'] as social.Provider;
  if (provider !== 'google' && provider !== 'microsoft') { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown provider' } }); return; }
  if (!social.providerConfigured(provider)) {
    res.status(412).json({ error: { code: 'PRECONDITION_FAILED', message: `${provider === 'google' ? 'Google' : 'Microsoft'} sign-in is not set up on this server.` } });
    return;
  }
  res.json({ url: social.authUrl(provider, req.auth!.user_id) });
});

function oauthCallback(provider: social.Provider) {
  return async (req: Request, res: Response) => {
    const code = req.query['code'] as string | undefined;
    const linkingUserId = social.stateLinkingUserId(req.query['state'] as string | undefined);
    const failWith = (message: string) => res.redirect(`${config.APP_PUBLIC_URL}/login?oauth_error=${encodeURIComponent(message)}`);
    if (linkingUserId === undefined) return failWith('That sign-in link expired or did not come from this app. Try again.');
    if (!code) return failWith('Sign-in was cancelled.');
    try {
      if (linkingUserId) {
        const target = await db.selectFrom('users').select(['id', 'firm_id', 'role'])
          .where('id', '=', linkingUserId).where('deleted_at', 'is', null).executeTakeFirst();
        if (!target) return failWith('That login no longer exists.');
        await social.linkSocialAccount(db, { user_id: target.id, firm_id: target.firm_id, business_id: null, effective_role: target.role, ...reqMeta(req) }, provider, code);
        res.redirect(`${config.APP_PUBLIC_URL}/account?linked=${provider}`);
        return;
      }
      const out = await social.completeOAuthSignIn(db, provider, code, reqMeta(req));
      setRefreshCookie(res, out.refresh_token, out.refresh_expires_at);
      res.redirect(`${config.APP_PUBLIC_URL}/oauth-complete`);
    } catch (e: unknown) {
      failWith(e instanceof Error ? e.message : 'Sign-in failed.');
    }
  };
}
router.get('/auth/google/callback', oauthCallback('google'));
router.get('/auth/microsoft/callback', oauthCallback('microsoft'));

router.delete('/auth/social/:provider', requireAuth, async (req, res, next) => {
  try {
    const provider = req.params['provider'];
    if (provider !== 'google' && provider !== 'microsoft') { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown provider' } }); return; }
    await social.unlinkSocialAccount(db, { user_id: req.auth!.user_id, firm_id: req.auth!.firm_id, business_id: null, effective_role: req.auth!.role, ...reqMeta(req) }, provider);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/auth/refresh', async (req, res, next) => {
  try {
    const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!raw) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'No refresh cookie' } });
    const out = await refresh(db, raw, reqMeta(req), 'web');
    setRefreshCookie(res, out.refresh_token, out.refresh_expires_at);
    const { refresh_token: _rt, refresh_expires_at: _exp, ...publicOut } = out;
    void _rt; void _exp;
    res.json(publicOut);
  } catch (e) { next(e); }
});

// Mobile's counterpart to /auth/refresh: the refresh token travels in the
// request body (rotated on every call) instead of an httpOnly cookie, since
// a native client has no cookie jar the API can rely on.
router.post('/auth/refresh-mobile', async (req, res, next) => {
  try {
    const body = schemas.refreshMobileSchema.parse(req.body);
    const out = await refresh(db, body.refresh_token, reqMeta(req), 'mobile');
    const { refresh_expires_at: _exp, ...withToken } = out;
    void _exp;
    res.json(withToken);
  } catch (e) { next(e); }
});

router.post('/auth/logout', async (req, res, next) => {
  try {
    const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (raw) await logout(db, raw, reqMeta(req));
    res.clearCookie(REFRESH_COOKIE, { path: '/auth' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/auth/logout-mobile', async (req, res, next) => {
  try {
    const body = schemas.refreshMobileSchema.parse(req.body);
    await logout(db, body.refresh_token, reqMeta(req));
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ── The signed-in person's own login ─────────────────────────────────────────
// These live under /auth because the refresh cookie is only sent there, and it
// is what says which of the person's sessions is this one.

function ctxFromReq(req: Request): ServiceCtx {
  return {
    user_id: req.auth!.user_id, firm_id: req.auth!.firm_id, business_id: null,
    effective_role: req.auth!.role, ...reqMeta(req),
  };
}

async function currentTokenHash(req: Request): Promise<string | null> {
  const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  return raw ? hashRefreshToken(raw) : null;
}

router.get('/auth/account', requireAuth, async (req, res, next) => {
  try {
    const [status, sessions] = await Promise.all([
      account.accountStatus(db, req.auth!.user_id),
      account.listSessions(db, req.auth!.user_id, await currentTokenHash(req)),
    ]);
    res.json({ ...status, sessions });
  } catch (e) { next(e); }
});

// A wrong current password counts toward the same hold as a wrong sign-in, so a
// session in the wrong hands cannot be used to guess the password. Counted once
// the request's own transaction has rolled back.
async function countIfWrongPassword(req: Request, e: unknown): Promise<void> {
  if (!(e instanceof account.WrongPasswordError)) return;
  try { await account.countWrongPassword(db, ctxFromReq(req)); }
  catch (countErr: unknown) { console.error(`[${req.request_id}] counting a wrong password failed`, countErr); }
}

router.post('/auth/password', requireAuth, async (req, res, next) => {
  try {
    const body = schemas.passwordChangeSchema.parse(req.body);
    const keep = await currentTokenHash(req);
    await db.transaction().execute(trx => account.changePassword(trx, ctxFromReq(req), { ...body, keep_token_hash: keep }));
    res.json({ ok: true });
  } catch (e) { await countIfWrongPassword(req, e); next(e); }
});

// Sign out everywhere else, keeping this browser.
router.post('/auth/sessions/sign-out-others', requireAuth, async (req, res, next) => {
  try {
    const keep = await currentTokenHash(req);
    res.json(await db.transaction().execute(trx => account.signOutSessions(trx, ctxFromReq(req), { keep_token_hash: keep })));
  } catch (e) { next(e); }
});

router.delete('/auth/sessions/:id', requireAuth, async (req, res, next) => {
  try {
    const keep = await currentTokenHash(req);
    res.json(await db.transaction().execute(trx =>
      account.signOutSessions(trx, ctxFromReq(req), { session_id: req.params['id']!, keep_token_hash: keep })));
  } catch (e) { next(e); }
});

router.post('/auth/two-step/setup', requireAuth, async (req, res, next) => {
  try { res.json(await db.transaction().execute(trx => account.beginTwoStep(trx, ctxFromReq(req)))); }
  catch (e) { next(e); }
});

router.post('/auth/two-step/confirm', requireAuth, async (req, res, next) => {
  try {
    const body = schemas.twoStepCodeSchema.parse(req.body);
    await db.transaction().execute(trx => account.confirmTwoStep(trx, ctxFromReq(req), body));
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/auth/two-step/off', requireAuth, async (req, res, next) => {
  try {
    const body = schemas.twoStepOffSchema.parse(req.body);
    await db.transaction().execute(trx => account.turnOffTwoStep(trx, ctxFromReq(req), body));
    res.json({ ok: true });
  } catch (e) { await countIfWrongPassword(req, e); next(e); }
});

export default router;
