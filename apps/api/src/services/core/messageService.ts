import { type Kysely, sql, type Transaction } from 'kysely';
import { AUDIT } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import { record as auditRecord } from '../audit/auditService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

// One thread per company, between the client and the firm.
// Spec: docs/specs/2026-10-08-accounts-and-roles-design.md

export type MessageRow = {
  id: string;
  body: string;
  created_at: string;
  author_name: string;
  author_role: string;
  mine: boolean;
};

/** A page of the thread, oldest first, ending at `before` (or at the newest). */
export async function listMessages(
  db: Kysely<DB>,
  q: { business_id: string; user_id: string; limit: number; before?: string | undefined },
): Promise<{ messages: MessageRow[]; has_more: boolean }> {
  let query = db.selectFrom('messages as m')
    .innerJoin('users as u', 'u.id', 'm.author_user_id')
    .select(['m.id', 'm.body', 'm.created_at', 'm.author_user_id', 'u.full_name as author_name', 'u.role as author_role'])
    .where('m.business_id', '=', q.business_id);
  if (q.before) query = query.where(sql<boolean>`m.created_at < ${q.before}::timestamptz`);
  const found = await query.orderBy('m.created_at', 'desc').orderBy('m.id', 'desc').limit(q.limit + 1).execute();
  return {
    has_more: found.length > q.limit,
    messages: found.slice(0, q.limit).reverse().map(m => ({
      id: m.id,
      body: m.body,
      created_at: new Date(m.created_at as unknown as string).toISOString(),
      author_name: m.author_name,
      author_role: m.author_role,
      mine: m.author_user_id === q.user_id,
    })),
  };
}

export async function postMessage(trx: Transaction<DB>, ctx: ServiceCtx, input: { business_id: string; body: string }) {
  const row = await trx.insertInto('messages')
    .values({ business_id: input.business_id, author_user_id: ctx.user_id, body: input.body.trim() })
    .returningAll().executeTakeFirstOrThrow();
  // What you write, you have read.
  await markRead(trx, { business_id: input.business_id, user_id: ctx.user_id });
  await auditRecord(trx, ctx, {
    action: AUDIT.MESSAGE_CREATE, entity_type: 'message', entity_id: row.id, before: null,
    // The words stay in the thread; the log notes that one was sent.
    after: { length: row.body.length },
  });
  return row;
}

export async function markRead(db: Kysely<DB> | Transaction<DB>, input: { business_id: string; user_id: string }): Promise<void> {
  await db.insertInto('message_reads')
    .values({ user_id: input.user_id, business_id: input.business_id })
    .onConflict(oc => oc.columns(['user_id', 'business_id']).doUpdateSet({ last_read_at: sql`now()` }))
    .execute();
}

/** Messages from other people since this person last read the thread. */
export async function unreadCount(db: Kysely<DB>, input: { business_id: string; user_id: string }): Promise<number> {
  const row = await db.selectFrom('messages as m')
    .leftJoin('message_reads as r', join => join.onRef('r.business_id', '=', 'm.business_id').on('r.user_id', '=', input.user_id))
    .select(({ fn }) => fn.countAll<string>().as('count'))
    .where('m.business_id', '=', input.business_id)
    .where('m.author_user_id', '<>', input.user_id)
    .where(sql<boolean>`r.last_read_at IS NULL OR m.created_at > r.last_read_at`)
    .executeTakeFirstOrThrow();
  return Number(row.count);
}
