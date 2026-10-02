import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../../db/types.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type AuditInput = {
  action: string;
  entity_type: string;
  entity_id: string | null;
  before: unknown | null;
  after: unknown | null;
};

export async function record(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: AuditInput,
): Promise<void> {
  await trx.insertInto('audit_logs').values({
    firm_id: ctx.firm_id,
    business_id: ctx.business_id,
    user_id: ctx.user_id === '00000000-0000-0000-0000-000000000000' ? null : ctx.user_id,
    request_id: ctx.request_id,
    action: input.action,
    entity_type: input.entity_type,
    entity_id: input.entity_id,
    before_state: input.before === null ? null : JSON.stringify(input.before),
    after_state: input.after === null ? null : JSON.stringify(input.after),
    ip_address: ctx.ip_address,
    user_agent: ctx.user_agent,
  }).execute();
}

export type AuditHistoryEntry = {
  id: string;
  action: string;
  created_at: string;
  user_name: string | null;
  before: unknown;
  after: unknown;
};

function parseState(raw: unknown): unknown {
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

/** Full history for one entity, newest first — the generic read side of `record`. */
export async function listByEntity(
  db: Kysely<DB>, business_id: string, entity_type: string, entity_id: string,
): Promise<AuditHistoryEntry[]> {
  const rows = await db.selectFrom('audit_logs as a')
    .leftJoin('users as u', 'u.id', 'a.user_id')
    .select(['a.id', 'a.action', 'a.created_at', 'a.before_state', 'a.after_state', 'u.full_name as user_name'])
    .where('a.business_id', '=', business_id)
    .where('a.entity_type', '=', entity_type)
    .where('a.entity_id', '=', entity_id)
    .orderBy('a.created_at', 'desc')
    .execute();
  return rows.map(r => ({
    id: r.id,
    action: r.action,
    created_at: r.created_at as unknown as string,
    user_name: r.user_name,
    before: parseState(r.before_state),
    after: parseState(r.after_state),
  }));
}
