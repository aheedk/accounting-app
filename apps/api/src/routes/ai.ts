import 'multer';
import { Router, type Request } from 'express';
import multer from 'multer';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import { ingestUploadedPdf } from '../services/ai/documentIngestService.js';
import type { ServiceCtx } from '../lib/ctx.js';

const router = Router({ mergeParams: true });

function ctxFromReq(req: Request): ServiceCtx {
  return {
    user_id: req.auth!.user_id, firm_id: req.auth!.firm_id,
    business_id: req.tenancy!.business_id, effective_role: req.tenancy!.effective_role,
    request_id: req.request_id, ip_address: req.ip ?? '0.0.0.0',
    user_agent: req.header('user-agent') ?? '',
  };
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // statements run larger than receipts
});

router.use('/businesses/:businessId', requireAuth, resolveBusiness);

/**
 * Upload a PDF directly instead of emailing it in. Same extraction path as the
 * Gmail worker; the open business is the client, so no addressee resolution.
 */
router.post(
  '/businesses/:businessId/ai/documents',
  requireMinRole('accountant'),
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        res.status(400).json({
          error: { code: 'VALIDATION_FAILED', message: 'no file uploaded (field name: "file")' },
        });
        return;
      }
      if (req.file.mimetype !== 'application/pdf') {
        res.status(400).json({
          error: { code: 'VALIDATION_FAILED', message: 'only PDF documents are supported' },
        });
        return;
      }
      const result = await ingestUploadedPdf(db, ctxFromReq(req), {
        buffer: req.file.buffer,
        filename: req.file.originalname,
      });
      res.status(201).json(result);
    } catch (e) { next(e); }
  },
);

/** Learned coding rules for this client. */
router.get('/businesses/:businessId/ai/coding-rules', async (req, res, next) => {
  try {
    const rows = await db.selectFrom('account_coding_memory as m')
      .leftJoin('bank_accounts as ba', 'ba.id', 'm.bank_account_id')
      .select([
        'm.id', 'm.normalized_vendor', 'm.direction', 'm.lines',
        'm.times_applied', 'm.times_corrected', 'm.last_applied_at', 'm.created_at',
        'ba.name as bank_account_name',
      ])
      .where('m.business_id', '=', req.tenancy!.business_id)
      .orderBy('m.times_applied', 'desc')
      .orderBy('m.normalized_vendor')
      .execute();
    res.json({ rules: rows });
  } catch (e) { next(e); }
});

router.delete(
  '/businesses/:businessId/ai/coding-rules/:ruleId',
  requireMinRole('accountant'),
  async (req, res, next) => {
    try {
      const deleted = await db.deleteFrom('account_coding_memory')
        .where('id', '=', req.params['ruleId']!)
        .where('business_id', '=', req.tenancy!.business_id)
        .returning('id')
        .executeTakeFirst();
      if (!deleted) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Coding rule not found' } });
        return;
      }
      res.status(204).end();
    } catch (e) { next(e); }
  },
);

export default router;
