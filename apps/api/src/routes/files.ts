import 'multer';
import { Router, type Request } from 'express';
import multer from 'multer';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as files from '../services/files/fileService.js';
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
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

router.use('/businesses/:businessId', requireAuth, resolveBusiness);

router.post('/businesses/:businessId/files', requireMinRole('staff'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'no file uploaded (field name: "file")' } });
      return;
    }
    const created = await db.transaction().execute(trx =>
      files.uploadFile(trx, ctxFromReq(req), {
        business_id: req.tenancy!.business_id,
        original_name: req.file!.originalname,
        mime_type: req.file!.mimetype,
        buffer: req.file!.buffer,
      }),
    );
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/files/:id/download', async (req, res, next) => {
  try {
    const { row, buffer } = await files.streamFile(db, req.tenancy!.business_id, req.params['id']!);
    res.setHeader('Content-Type', row.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(row.original_name)}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/files/:id', async (req, res, next) => {
  try { res.json(await files.getFileById(db, req.tenancy!.business_id, req.params['id']!)); }
  catch (e) { next(e); }
});

export default router;
