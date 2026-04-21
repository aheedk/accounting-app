import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db/index.js';

const router = Router();

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const { user_id } = req.auth!;
    const user = await db.selectFrom('users')
      .select(['id', 'email', 'full_name', 'role', 'firm_id'])
      .where('id', '=', user_id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!user) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    const businesses = await db.selectFrom('user_business_access as uba')
      .innerJoin('businesses as b', 'b.id', 'uba.business_id')
      .select(['b.id', 'b.name', 'uba.role_override'])
      .where('uba.user_id', '=', user_id)
      .where('b.deleted_at', 'is', null)
      .execute();
    res.json({ user, businesses });
  } catch (e) { next(e); }
});

export default router;
