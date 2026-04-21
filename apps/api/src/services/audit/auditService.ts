import type { Transaction } from 'kysely';
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
