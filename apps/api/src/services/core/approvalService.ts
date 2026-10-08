import { type Kysely, sql, type Transaction } from 'kysely';
import type { ZodTypeAny } from 'zod';
import { AUDIT, ERR, schemas } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import { BusinessRuleError, NotFoundError } from '../../lib/errors.js';
import { record as auditRecord } from '../audit/auditService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

// The approval step: with it switched on for a company, the entries a staff
// login saves that would post at once wait for an accountant instead.
// Spec: docs/specs/2026-10-08-accounts-and-roles-design.md
//
// A held request is kept exactly as it was sent. Approving it sends it again
// as the accountant, so it goes through the same route, the same checks and the
// same service as if the accountant had typed it. Nothing about posting is
// written a second time here.

type Describe = (db: Kysely<DB>, business_id: string, id: string | null, body: Record<string, unknown>) => Promise<{ summary: string; amount: string | null }>;

export type HeldAction = {
  method: 'POST' | 'PATCH';
  /** The path after `/businesses/:businessId`; a capture is the record's id. */
  pattern: RegExp;
  action: string;
  /** The same schema the route parses with, so a bad entry is refused when saved, not when approved. */
  schema: ZodTypeAny;
  describe: Describe;
};

const ID = '([0-9a-fA-F-]{36})';

const linesTotal = (body: Record<string, unknown>): string | null => {
  const lines = body['lines'];
  if (!Array.isArray(lines)) return null;
  const total = lines.reduce<number>((sum, line) => sum + (Number((line as { amount?: unknown }).amount) || 0), 0);
  return total.toFixed(2);
};
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

const payee = (label: string, verb: string): Describe => async (_db, _biz, _id, body) => ({
  summary: `${verb} ${label}${text(body['payee_text']) ? ` to ${text(body['payee_text'])}` : ''}${text(body['check_number']) ? `, no. ${text(body['check_number'])}` : ''}`,
  amount: linesTotal(body),
});

const bankLine = (table: 'bank_transactions' | 'integration_inbox', verb: string): Describe => async (db, business_id, id) => {
  if (!id) return { summary: `${verb} a bank line`, amount: null };
  const row = table === 'bank_transactions'
    ? await db.selectFrom('bank_transactions').select(['description', 'amount']).where('id', '=', id).where('business_id', '=', business_id).executeTakeFirst()
    : await db.selectFrom('integration_inbox').select(['description', 'amount']).where('id', '=', id).where('business_id', '=', business_id).executeTakeFirst();
  return row
    ? { summary: `${verb} "${row.description}"`, amount: String(Math.abs(Number(row.amount)).toFixed(2)) }
    : { summary: `${verb} a bank line`, amount: null };
};

export const HELD_ACTIONS: HeldAction[] = [
  { method: 'POST', pattern: /^\/expense-transactions$/, action: 'expense.create', schema: schemas.expenseTransactionCreateSchema, describe: payee('expense', 'New') },
  { method: 'PATCH', pattern: new RegExp(`^/expense-transactions/${ID}$`), action: 'expense.update', schema: schemas.expenseTransactionUpdateSchema, describe: payee('expense', 'Change to an') },
  { method: 'POST', pattern: /^\/checks$/, action: 'check.create', schema: schemas.checkCreateSchema, describe: payee('check', 'New') },
  { method: 'PATCH', pattern: new RegExp(`^/checks/${ID}$`), action: 'check.update', schema: schemas.checkUpdateSchema, describe: payee('check', 'Change to a') },
  {
    method: 'POST', pattern: /^\/bank-deposits$/, action: 'bank_deposit.create', schema: schemas.bankDepositCreateSchema,
    describe: async (_db, _biz, _id, body) => ({ summary: `New bank deposit${text(body['deposit_date']) ? ` dated ${text(body['deposit_date'])}` : ''}`, amount: linesTotal(body) }),
  },
  {
    method: 'PATCH', pattern: new RegExp(`^/bank-deposits/${ID}$`), action: 'bank_deposit.update', schema: schemas.bankDepositUpdateSchema,
    describe: async (_db, _biz, _id, body) => ({ summary: 'Change to a bank deposit', amount: linesTotal(body) }),
  },
  { method: 'POST', pattern: new RegExp(`^/bank-transactions/${ID}/categorize$`), action: 'bank_transaction.categorize', schema: schemas.bankTransactionCategorizeSchema, describe: bankLine('bank_transactions', 'Categorize') },
  { method: 'POST', pattern: new RegExp(`^/bank-transactions/${ID}/match$`), action: 'bank_transaction.match', schema: schemas.bankTransactionMatchSchema, describe: bankLine('bank_transactions', 'Match') },
  { method: 'POST', pattern: new RegExp(`^/integration-inbox/${ID}/categorize$`), action: 'integration_inbox.categorize', schema: schemas.integrationInboxCategorizeSchema, describe: bankLine('integration_inbox', 'Categorize') },
  { method: 'POST', pattern: new RegExp(`^/integration-inbox/${ID}/match$`), action: 'integration_inbox.match', schema: schemas.integrationInboxMatchSchema, describe: bankLine('integration_inbox', 'Match') },
  {
    method: 'POST', pattern: /^\/item-receipts$/, action: 'item_receipt.create', schema: schemas.itemReceiptCreateSchema,
    describe: async (db, business_id, _id, body) => {
      const poId = text(body['purchase_order_id']);
      const po = poId
        ? await db.selectFrom('purchase_orders').select('po_number').where('id', '=', poId).where('business_id', '=', business_id).executeTakeFirst()
        : undefined;
      return { summary: `Receive stock${po ? ` on purchase order ${po.po_number}` : ''} (raises a bill)`, amount: null };
    },
  },
  {
    method: 'POST', pattern: new RegExp(`^/inventory-items/${ID}/adjust-stock$`), action: 'stock.adjust', schema: schemas.stockAdjustSchema,
    describe: async (db, business_id, id, body) => {
      const item = id
        ? await db.selectFrom('inventory_items').select('name').where('id', '=', id).where('business_id', '=', business_id).executeTakeFirst()
        : undefined;
      return { summary: `Stock adjustment of ${text(body['quantity_delta']) ?? '?'}${item ? ` on ${item.name}` : ''}`, amount: null };
    },
  },
];

/** The held action a request is, if it is one. `path` is what follows `/businesses/:businessId`. */
export function findHeldAction(method: string, path: string): { held: HeldAction; record_id: string | null } | null {
  const clean = path.length > 1 ? path.replace(/\/+$/, '') : path;
  for (const held of HELD_ACTIONS) {
    if (held.method !== method.toUpperCase()) continue;
    const match = held.pattern.exec(clean);
    if (match) return { held, record_id: match[1] ?? null };
  }
  return null;
}

export async function needsApproval(db: Kysely<DB>, business_id: string): Promise<boolean> {
  const row = await db.selectFrom('businesses').select('staff_entries_need_approval').where('id', '=', business_id).executeTakeFirst();
  return row?.staff_entries_need_approval === true;
}

export async function createRequest(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: { business_id: string; action: string; method: string; path: string; payload: unknown; summary: string; amount: string | null },
) {
  const row = await trx.insertInto('approval_requests').values({
    business_id: input.business_id,
    requested_by_user_id: ctx.user_id,
    action: input.action,
    method: input.method,
    path: input.path,
    payload: JSON.stringify(input.payload),
    summary: input.summary,
    amount: input.amount,
  }).returningAll().executeTakeFirstOrThrow();
  await auditRecord(trx, ctx, {
    action: AUDIT.APPROVAL_REQUEST, entity_type: 'approval_request', entity_id: row.id, before: null,
    after: { action: row.action, summary: row.summary, amount: row.amount },
  });
  return row;
}

export type ApprovalRow = {
  id: string;
  action: string;
  summary: string;
  amount: string | null;
  status: string;
  payload: unknown;
  created_at: string;
  requested_by: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
};

/** Newest first. `requested_by` narrows it to one person's own requests (what staff see). */
export async function listRequests(
  db: Kysely<DB>,
  q: { business_id: string; status?: string | undefined; requested_by?: string | undefined; limit: number },
): Promise<ApprovalRow[]> {
  let query = db.selectFrom('approval_requests as a')
    .innerJoin('users as r', 'r.id', 'a.requested_by_user_id')
    .leftJoin('users as d', 'd.id', 'a.decided_by_user_id')
    .select(['a.id', 'a.action', 'a.summary', 'a.amount', 'a.status', 'a.payload', 'a.created_at', 'a.decided_at', 'a.decision_note', 'r.full_name as requested_by', 'd.full_name as decided_by'])
    .where('a.business_id', '=', q.business_id);
  if (q.status) query = query.where('a.status', '=', q.status);
  if (q.requested_by) query = query.where('a.requested_by_user_id', '=', q.requested_by);
  const rows = await query.orderBy('a.created_at', 'desc').limit(q.limit).execute();
  const iso = (value: unknown) => (value ? new Date(value as string).toISOString() : null);
  return rows.map(r => ({
    id: r.id,
    action: r.action,
    summary: r.summary,
    amount: r.amount,
    // Someone looking mid-approval sees it as still waiting.
    status: r.status === 'approving' ? 'pending' : r.status,
    payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload,
    created_at: iso(r.created_at)!,
    requested_by: r.requested_by,
    decided_by: r.decided_by,
    decided_at: iso(r.decided_at),
    decision_note: r.decision_note,
  }));
}

export async function pendingCount(db: Kysely<DB>, business_id: string): Promise<number> {
  const row = await db.selectFrom('approval_requests')
    .select(({ fn }) => fn.countAll<string>().as('count'))
    .where('business_id', '=', business_id).where('status', 'in', ['pending', 'approving'])
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

/**
 * Takes a waiting request for approval, so that it can be recorded once and
 * only once. Whoever calls this must then call finishApproval or releaseClaim.
 */
export async function claimForApproval(db: Kysely<DB>, input: { id: string; business_id: string }) {
  const claimed = await db.updateTable('approval_requests').set({ status: 'approving' })
    .where('id', '=', input.id).where('business_id', '=', input.business_id).where('status', '=', 'pending')
    .returningAll().executeTakeFirst();
  if (claimed) return claimed;
  const existing = await db.selectFrom('approval_requests').select('status')
    .where('id', '=', input.id).where('business_id', '=', input.business_id).executeTakeFirst();
  if (!existing) throw new NotFoundError('approval_request', input.id);
  throw new BusinessRuleError(ERR.INVALID_STATE_TRANSITION,
    existing.status === 'approving' ? 'Someone else is approving this right now.' : `This was already ${existing.status}.`);
}

export async function releaseClaim(db: Kysely<DB>, id: string): Promise<void> {
  await db.updateTable('approval_requests').set({ status: 'pending' }).where('id', '=', id).where('status', '=', 'approving').execute();
}

export async function finishApproval(trx: Transaction<DB>, ctx: ServiceCtx, input: { id: string; result: unknown }) {
  const row = await trx.updateTable('approval_requests')
    .set({ status: 'approved', decided_by_user_id: ctx.user_id, decided_at: sql`now()`, result: JSON.stringify(input.result ?? null) })
    .where('id', '=', input.id).where('status', '=', 'approving')
    .returningAll().executeTakeFirstOrThrow();
  await auditRecord(trx, ctx, {
    action: AUDIT.APPROVAL_APPROVE, entity_type: 'approval_request', entity_id: row.id,
    before: { status: 'pending' }, after: { status: 'approved', action: row.action, summary: row.summary },
  });
  return row;
}

export async function rejectRequest(trx: Transaction<DB>, ctx: ServiceCtx, input: { id: string; business_id: string; note: string | null }) {
  const row = await trx.updateTable('approval_requests')
    .set({ status: 'rejected', decided_by_user_id: ctx.user_id, decided_at: sql`now()`, decision_note: input.note })
    .where('id', '=', input.id).where('business_id', '=', input.business_id).where('status', '=', 'pending')
    .returningAll().executeTakeFirst();
  if (!row) {
    const existing = await trx.selectFrom('approval_requests').select('status')
      .where('id', '=', input.id).where('business_id', '=', input.business_id).executeTakeFirst();
    if (!existing) throw new NotFoundError('approval_request', input.id);
    throw new BusinessRuleError(ERR.INVALID_STATE_TRANSITION, `This was already ${existing.status}.`);
  }
  await auditRecord(trx, ctx, {
    action: AUDIT.APPROVAL_REJECT, entity_type: 'approval_request', entity_id: row.id,
    before: { status: 'pending' }, after: { status: 'rejected', note: input.note },
  });
  return row;
}
