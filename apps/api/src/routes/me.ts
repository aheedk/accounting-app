import { Router } from 'express';
import { z } from 'zod';
import { sql } from 'kysely';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { businessesForUser, firmSignInSettings, mayOpenPayroll, setupSteps } from '../services/auth/authService.js';

const router = Router();

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const { user_id } = req.auth!;
    const user = await db.selectFrom('users')
      .select(['id', 'email', 'full_name', 'role', 'firm_id', 'payroll_access', 'must_change_password', 'totp_enabled_at'])
      .where('id', '=', user_id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!user) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    // The same list logging in gives. A firm admin can open every client of the
    // firm, and used to lose all but the explicitly granted ones on a page reload.
    const businesses = await businessesForUser(db, user);
    // What signing in says too: steps left before the app opens, and the idle sign-out.
    const firm = await firmSignInSettings(db, user.firm_id);
    const { must_change_password: _m, totp_enabled_at: _t, ...shown } = user;
    void _m; void _t;
    res.json({
      user: {
        ...shown, payroll_access: mayOpenPayroll(user),
        setup_required: setupSteps(user, firm), idle_sign_out_minutes: firm.idle_sign_out_minutes,
      },
      businesses,
    });
  } catch (e) { next(e); }
});

const registerPushTokenSchema = z.object({
  token: z.string().min(1),
  platform: z.enum(['ios', 'android']),
});

// A push token belongs to a device, not a business — registered once per
// login regardless of which business is active. Upsert on token (unique):
// a reinstall or a second login on the same device just refreshes who owns
// it and bumps last_used_at, rather than accumulating stale duplicate rows.
router.post('/me/push-tokens', requireAuth, async (req, res, next) => {
  try {
    const body = registerPushTokenSchema.parse(req.body);
    await db.insertInto('push_tokens')
      .values({ user_id: req.auth!.user_id, token: body.token, platform: body.platform })
      .onConflict(oc => oc.column('token').doUpdateSet({
        user_id: req.auth!.user_id, platform: body.platform, last_used_at: sql`now()`,
      }))
      .execute();
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/me/push-tokens', requireAuth, async (req, res, next) => {
  try {
    const body = z.object({ token: z.string().min(1) }).parse(req.body);
    await db.deleteFrom('push_tokens')
      .where('token', '=', body.token)
      .where('user_id', '=', req.auth!.user_id)
      .execute();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
