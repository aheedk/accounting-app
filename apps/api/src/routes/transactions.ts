import { Router } from 'express';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { listTransactions, TRANSACTION_TYPES, type TransactionSortKey, type TransactionType } from '../services/core/transactionsService.js';

const router = Router({ mergeParams: true });

router.use('/businesses/:businessId', requireAuth, resolveBusiness);

const SORT_KEYS: TransactionSortKey[] = ['date', 'type', 'ref_no', 'due_date', 'balance', 'total_amount', 'updated_at'];

function isTransactionType(v: unknown): v is TransactionType {
  return typeof v === 'string' && (TRANSACTION_TYPES as readonly string[]).includes(v);
}
function isSortKey(v: unknown): v is TransactionSortKey {
  return typeof v === 'string' && (SORT_KEYS as readonly string[]).includes(v);
}

router.get('/businesses/:businessId/transactions', async (req, res, next) => {
  try {
    const q = req.query;
    const type = isTransactionType(q['type']) ? q['type'] : null;
    const amountOp = q['amount_op'];
    const page = Math.max(1, Number(q['page'] ?? 1) || 1);
    const pageSize = Math.min(150, Math.max(1, Number(q['page_size'] ?? 25) || 25));

    const result = await listTransactions(db, {
      business_id: req.tenancy!.business_id,
      type,
      date_start: typeof q['date_start'] === 'string' ? q['date_start'] : null,
      date_end: typeof q['date_end'] === 'string' ? q['date_end'] : null,
      ref_no: typeof q['ref_no'] === 'string' && q['ref_no'] ? q['ref_no'] : null,
      contact_id: typeof q['contact_id'] === 'string' && q['contact_id'] ? q['contact_id'] : null,
      amount_op: amountOp === 'eq' || amountOp === 'gt' || amountOp === 'gte' || amountOp === 'lt' || amountOp === 'lte' || amountOp === 'between' ? amountOp : null,
      amount_value: typeof q['amount_value'] === 'string' ? q['amount_value'] : null,
      amount_value2: typeof q['amount_value2'] === 'string' ? q['amount_value2'] : null,
      sort_key: isSortKey(q['sort_key']) ? q['sort_key'] : 'date',
      sort_dir: q['sort_dir'] === 'asc' ? 'asc' : 'desc',
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    res.json({ transactions: result.rows, total: result.total, page, page_size: pageSize });
  } catch (e) { next(e); }
});

export default router;
