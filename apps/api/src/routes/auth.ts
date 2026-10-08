import { Router, type Request, type Response } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { login, refresh, logout } from '../services/auth/authService.js';
import * as account from '../services/auth/accountService.js';
import { hashRefreshToken } from '../services/auth/tokenService.js';
import { requireAuth } from '../middleware/auth.js';
import type { ServiceCtx } from '../lib/ctx.js';
import { config } from '../config.js';

const router = Router();

function reqMeta(req: Request) {
  return {
    request_id: req.request_id,
    ip_address: req.ip ?? '0.0.0.0',
    user_agent: req.headers['user-agent'] ?? '',
  };
}

const REFRESH_COOKIE = 'acct_rt';

function setRefreshCookie(res: Response, raw: string) {
  const maxAge = config.JWT_REFRESH_TTL_DAYS * 24 * 3600 * 1000;
  res.cookie(REFRESH_COOKIE, raw, {
    httpOnly: true,
    secure: config.NODE_ENV !== 'development',
    sameSite: config.NODE_ENV === 'development' ? 'lax' : 'none',
    maxAge,
    path: '/auth',
  });
}

router.post('/auth/login', async (req, res, next) => {
  try {
    const body = schemas.loginRequestSchema.parse(req.body);
    const out = await login(db, body, reqMeta(req));
    setRefreshCookie(res, out.refresh_token);
    const { refresh_token: _rt, ...publicOut } = out;
    void _rt;
    res.json(publicOut);
  } catch (e) { next(e); }
});

router.post('/auth/refresh', async (req, res, next) => {
  try {
    const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!raw) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'No refresh cookie' } });
    const out = await refresh(db, raw, reqMeta(req));
    setRefreshCookie(res, out.refresh_token);
    const { refresh_token: _rt, ...publicOut } = out;
    void _rt;
    res.json(publicOut);
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

router.post('/auth/password', requireAuth, async (req, res, next) => {
  try {
    const body = schemas.passwordChangeSchema.parse(req.body);
    const keep = await currentTokenHash(req);
    await db.transaction().execute(trx => account.changePassword(trx, ctxFromReq(req), { ...body, keep_token_hash: keep }));
    res.json({ ok: true });
  } catch (e) { next(e); }
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
  } catch (e) { next(e); }
});

export default router;
