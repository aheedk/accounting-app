import { sql, type Kysely } from 'kysely';
import type { DB } from '../../db/types.js';

// The activity log: who did what, newest first. Every change in the app has
// always been recorded in audit_logs; this is the read side for a person,
// across a whole company (or, for a firm admin, the firm's sign-ins and users).
// Spec: docs/specs/2026-10-08-accounts-and-roles-design.md

export type ActivityQuery = {
  firm_id: string;
  /** A company's records, or null for what belongs to no company: sign-ins and the firm's users. */
  business_id: string | null;
  limit: number;
  /** Rows older than this moment (the last row of the page before). */
  before?: string | undefined;
  user_id?: string | undefined;
  entity_type?: string | undefined;
};

export type ActivityRow = {
  id: string;
  created_at: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  user_id: string | null;
  user_name: string | null;
  before: unknown;
  after: unknown;
};

const parse = (raw: unknown): unknown => (typeof raw === 'string' ? JSON.parse(raw) : raw);

export async function listActivity(db: Kysely<DB>, q: ActivityQuery): Promise<{ rows: ActivityRow[]; has_more: boolean }> {
  let query = db.selectFrom('audit_logs as a')
    .leftJoin('users as u', 'u.id', 'a.user_id')
    .select(['a.id', 'a.created_at', 'a.action', 'a.entity_type', 'a.entity_id', 'a.user_id', 'a.before_state', 'a.after_state', 'u.full_name as user_name'])
    .where('a.firm_id', '=', q.firm_id);
  query = q.business_id === null ? query.where('a.business_id', 'is', null) : query.where('a.business_id', '=', q.business_id);
  if (q.before) query = query.where(sql<boolean>`a.created_at < ${q.before}::timestamptz`);
  if (q.user_id) query = query.where('a.user_id', '=', q.user_id);
  if (q.entity_type) query = query.where('a.entity_type', '=', q.entity_type);
  // One more than asked for says whether there is another page.
  const found = await query.orderBy('a.created_at', 'desc').orderBy('a.id', 'desc').limit(q.limit + 1).execute();
  return {
    has_more: found.length > q.limit,
    rows: found.slice(0, q.limit).map(r => ({
      id: r.id,
      created_at: new Date(r.created_at as unknown as string).toISOString(),
      action: r.action,
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      user_id: r.user_id,
      user_name: r.user_name,
      before: parse(r.before_state),
      after: parse(r.after_state),
    })),
  };
}

/** What the log can be narrowed by: the people and the kinds of record that appear in it. */
export async function activityFacets(db: Kysely<DB>, q: { firm_id: string; business_id: string | null }) {
  let users = db.selectFrom('audit_logs as a').innerJoin('users as u', 'u.id', 'a.user_id')
    .select(['u.id', 'u.full_name']).distinct().where('a.firm_id', '=', q.firm_id);
  let types = db.selectFrom('audit_logs as a').select('a.entity_type').distinct().where('a.firm_id', '=', q.firm_id);
  if (q.business_id === null) {
    users = users.where('a.business_id', 'is', null);
    types = types.where('a.business_id', 'is', null);
  } else {
    users = users.where('a.business_id', '=', q.business_id);
    types = types.where('a.business_id', '=', q.business_id);
  }
  const [userRows, typeRows] = await Promise.all([users.orderBy('u.full_name').execute(), types.orderBy('a.entity_type').execute()]);
  return {
    users: userRows.map(u => ({ id: u.id, name: u.full_name })),
    entity_types: typeRows.map(t => t.entity_type),
  };
}
