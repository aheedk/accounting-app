import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { businessesForUser, mayOpenPayroll } from '../services/auth/authService.js';

const router = Router();

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const { user_id } = req.auth!;
    const user = await db.selectFrom('users')
      .select(['id', 'email', 'full_name', 'role', 'firm_id', 'payroll_access'])
      .where('id', '=', user_id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!user) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    // The same list logging in gives. A firm admin can open every client of the
    // firm, and used to lose all but the explicitly granted ones on a page reload.
    const businesses = await businessesForUser(db, user);
    res.json({ user: { ...user, payroll_access: mayOpenPayroll(user) }, businesses });
  } catch (e) { next(e); }
});

export default router;
