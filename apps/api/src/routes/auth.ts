import { Router, type Request, type Response, type NextFunction } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { login, refresh, logout } from '../services/auth/authService.js';
import { config } from '../config.js';

const router = Router();

function reqMeta(req: Request) {
  return {
    request_id: req.headers['x-request-id'] as string ?? crypto.randomUUID(),
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

export default router;
