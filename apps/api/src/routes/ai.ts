import 'multer';
import { Router, type Request } from 'express';
import multer from 'multer';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { refuseViewOnly, requireMinRole } from '../middleware/rbac.js';
import { ERR, schemas } from '@accounting/shared';
import { ingestUploadedPdf } from '../services/ai/documentIngestService.js';
import { updateLearnedRule } from '../services/ai/autoCodingService.js';
import type { ServiceCtx } from '../lib/ctx.js';
import { BusinessRuleError } from '../lib/errors.js';
import { RateLimit } from '../lib/rateLimit.js';

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
const UPLOAD_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'] as const;

// Each document is read by the AI, which is paid per call. A firm sends in tens
// a day; this stops a login in the wrong hands, or a script, from sending
// thousands (security review 2026-10-21).
export const DOCUMENTS_PER_HOUR = 200;
export const documentUploads = new RateLimit(DOCUMENTS_PER_HOUR, 60 * 60_000);

router.post(
  '/businesses/:businessId/ai/documents',
  // Anyone but a view-only login, the client included: what is sent in only
  // waits in the inbox, and reaches the books when an accountant approves it.
  refuseViewOnly,
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        res.status(400).json({
          error: { code: 'VALIDATION_FAILED', message: 'no file uploaded (field name: "file")' },
        });
        return;
      }
      // Images are accepted for photographed check stubs and receipts.
      const mediaType = UPLOAD_TYPES.find(type => type === req.file!.mimetype);
      if (!mediaType) {
        res.status(400).json({
          error: { code: 'VALIDATION_FAILED', message: 'Upload a PDF or an image (PNG, JPEG, WebP).' },
        });
        return;
      }
      const wait = documentUploads.take(req.auth!.user_id);
      if (wait !== null) {
        throw new BusinessRuleError(ERR.RATE_LIMITED,
          `${DOCUMENTS_PER_HOUR} documents have been sent in from this login in the last hour. Try again in ${wait} minute${wait === 1 ? '' : 's'}.`);
      }
      const result = await ingestUploadedPdf(db, ctxFromReq(req), {
        buffer: req.file.buffer,
        filename: req.file.originalname,
        media_type: mediaType,
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

/** Change where a learned rule posts. */
router.patch(
  '/businesses/:businessId/ai/coding-rules/:ruleId',
  requireMinRole('accountant'),
  async (req, res, next) => {
    try {
      const body = schemas.codingRuleUpdateSchema.parse(req.body);
      const updated = await db.transaction().execute(trx =>
        updateLearnedRule(trx, ctxFromReq(req), { rule_id: req.params['ruleId']!, account_ids: body.account_ids }),
      );
      res.json(updated);
    } catch (e) { next(e); }
  },
);

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
