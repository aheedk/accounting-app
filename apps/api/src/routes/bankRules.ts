import { Router } from 'express';
import type { Request } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as bankRules from '../services/banking/bankRuleService.js';
import * as ruleApply from '../services/banking/ruleApplyService.js';
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

router.use('/businesses/:businessId', requireAuth, resolveBusiness);

router.get('/businesses/:businessId/bank-rules', async (req, res, next) => {
  try {
    const rules = await bankRules.listRules(db, req.tenancy!.business_id);
    res.json({ bank_rules: rules });
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/bank-rules', requireMinRole('staff'), async (req, res, next) => {
  try {
    const body = schemas.bankRuleCreateSchema.parse(req.body);
    const input: bankRules.CreateRuleInput = {
      business_id: req.tenancy!.business_id,
      name: body.name,
      description_contains: body.description_contains,
      min_amount: body.min_amount ?? null,
      max_amount: body.max_amount ?? null,
      sign_filter: body.sign_filter ?? 'any',
      offset_account_id: body.offset_account_id,
      priority: body.priority ?? 100,
      bank_account_id: body.bank_account_id ?? null,
    };
    const created = await db.transaction().execute(trx =>
      bankRules.createRule(trx, ctxFromReq(req), input),
    );
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.patch('/businesses/:businessId/bank-rules/:id', requireMinRole('staff'), async (req, res, next) => {
  try {
    const parsed = schemas.bankRuleUpdateSchema.parse(req.body);
    const patch: bankRules.UpdateRuleInput['patch'] = {};
    if (parsed.name !== undefined) patch.name = parsed.name;
    if (parsed.description_contains !== undefined) patch.description_contains = parsed.description_contains;
    if (parsed.min_amount !== undefined) patch.min_amount = parsed.min_amount ?? null;
    if (parsed.max_amount !== undefined) patch.max_amount = parsed.max_amount ?? null;
    if (parsed.sign_filter !== undefined) patch.sign_filter = parsed.sign_filter;
    if (parsed.offset_account_id !== undefined) patch.offset_account_id = parsed.offset_account_id;
    if (parsed.priority !== undefined) patch.priority = parsed.priority;
    if (parsed.is_active !== undefined) patch.is_active = parsed.is_active;
    if (parsed.bank_account_id !== undefined) patch.bank_account_id = parsed.bank_account_id ?? null;
    const updated = await db.transaction().execute(trx =>
      bankRules.updateRule(trx, ctxFromReq(req), { rule_id: req.params['id']!, patch }),
    );
    res.json(updated);
  } catch (e) { next(e); }
});

router.delete('/businesses/:businessId/bank-rules/:id', requireMinRole('accountant'), async (req, res, next) => {
  try {
    await db.transaction().execute(trx =>
      bankRules.deleteRule(trx, ctxFromReq(req), { rule_id: req.params['id']! }),
    );
    res.status(204).end();
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/bank-rules/apply', requireMinRole('staff'), async (req, res, next) => {
  try {
    const body = schemas.bankRuleApplySchema.parse(req.body);
    const result = await db.transaction().execute(trx =>
      ruleApply.applyRules(trx, ctxFromReq(req), {
        business_id: req.tenancy!.business_id,
        bank_account_id: body.bank_account_id,
      }),
    );
    res.json(result);
  } catch (e) { next(e); }
});

export default router;
