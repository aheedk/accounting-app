import { sql, type Kysely, type Transaction } from 'kysely';
import { AUDIT, ERR, normalizePermissions, type Permissions } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import { BusinessRuleError, NotFoundError } from '../../lib/errors.js';
import { reissueAccessTokens } from '../auth/accountService.js';
import { record as auditRecord } from '../audit/auditService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

// The firm's own roles: a name and a level for each area of the books.
// Spec: docs/specs/2026-11-09-custom-roles-design.md

export type CustomRole = {
  id: string;
  name: string;
  description: string | null;
  permissions: Permissions;
  /** Logins whose firm-wide role it is. */
  users: Array<{ id: string; full_name: string; email: string }>;
  /** Grants of it for one company. */
  company_grants: number;
  updated_at: string;
};

function shape(row: { id: string; name: string; description: string | null; permissions: unknown; updated_at: unknown }) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    permissions: normalizePermissions(row.permissions),
    updated_at: new Date(row.updated_at as string).toISOString(),
  };
}

export async function listRoles(db: Kysely<DB>, firm_id: string): Promise<CustomRole[]> {
  const roles = await db.selectFrom('firm_roles')
    .select(['id', 'name', 'description', 'permissions', 'updated_at'])
    .where('firm_id', '=', firm_id)
    .orderBy(sql`lower(name)`)
    .execute();
  if (roles.length === 0) return [];
  const ids = roles.map(r => r.id);
  const holders = await db.selectFrom('users')
    .select(['id', 'full_name', 'email', 'custom_role_id'])
    .where('custom_role_id', 'in', ids).where('deleted_at', 'is', null)
    .orderBy('full_name')
    .execute();
  const grants = await db.selectFrom('user_business_access as uba')
    .innerJoin('users as u', 'u.id', 'uba.user_id')
    .select(['uba.custom_role_id', sql<string>`count(*)`.as('n')])
    .where('uba.custom_role_id', 'in', ids).where('u.deleted_at', 'is', null)
    .groupBy('uba.custom_role_id')
    .execute();
  return roles.map(role => ({
    ...shape(role),
    users: holders.filter(h => h.custom_role_id === role.id).map(h => ({ id: h.id, full_name: h.full_name, email: h.email })),
    company_grants: Number(grants.find(g => g.custom_role_id === role.id)?.n ?? 0),
  }));
}

/** A role of this firm, or not found (a role of another firm is never found). */
export async function roleInFirm(trx: Kysely<DB> | Transaction<DB>, firm_id: string, id: string) {
  const row = await trx.selectFrom('firm_roles')
    .select(['id', 'name', 'description', 'permissions', 'updated_at'])
    .where('id', '=', id).where('firm_id', '=', firm_id)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('role', id);
  return shape(row);
}

async function refuseTakenName(trx: Transaction<DB>, firm_id: string, name: string, except?: string) {
  let query = trx.selectFrom('firm_roles').select('id')
    .where('firm_id', '=', firm_id).where(sql`lower(name)`, '=', name.toLowerCase());
  if (except) query = query.where('id', '<>', except);
  if (await query.executeTakeFirst()) {
    throw new BusinessRuleError(ERR.DUPLICATE_RESOURCE, `There is already a role called ${name}.`);
  }
}

/**
 * Everyone holding the role, firm-wide or for a company: their access tokens
 * stop counting, so open browsers renew at once and redraw the menu. (The API
 * itself reads the levels on every request, so it never waits for this.)
 */
async function reissueForHolders(trx: Transaction<DB>, role_id: string): Promise<void> {
  const rows = await trx.selectFrom('users').select('id').where('custom_role_id', '=', role_id)
    .union(trx.selectFrom('user_business_access').select('user_id as id').where('custom_role_id', '=', role_id))
    .execute();
  for (const row of rows) await reissueAccessTokens(trx, row.id);
}

export async function createRole(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: { name: string; description?: string | null | undefined; permissions: Permissions },
) {
  await refuseTakenName(trx, ctx.firm_id, input.name);
  const row = await trx.insertInto('firm_roles').values({
    firm_id: ctx.firm_id,
    name: input.name,
    description: input.description ?? null,
    permissions: JSON.stringify(input.permissions),
  }).returning(['id', 'name', 'description', 'permissions', 'updated_at']).executeTakeFirstOrThrow();
  const created = shape(row);
  await auditRecord(trx, ctx, { action: AUDIT.ROLE_CREATE, entity_type: 'role', entity_id: created.id, before: null, after: created });
  return created;
}

export async function updateRole(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: { id: string; name?: string | undefined; description?: string | null | undefined; permissions?: Permissions | undefined },
) {
  const before = await roleInFirm(trx, ctx.firm_id, input.id);
  if (input.name !== undefined) await refuseTakenName(trx, ctx.firm_id, input.name, input.id);
  const patch = {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.permissions !== undefined ? { permissions: JSON.stringify(input.permissions) } : {}),
  };
  if (Object.keys(patch).length === 0) return before;
  const row = await trx.updateTable('firm_roles').set(patch)
    .where('id', '=', input.id).where('firm_id', '=', ctx.firm_id)
    .returning(['id', 'name', 'description', 'permissions', 'updated_at']).executeTakeFirstOrThrow();
  const after = shape(row);
  await reissueForHolders(trx, input.id);
  await auditRecord(trx, ctx, { action: AUDIT.ROLE_UPDATE, entity_type: 'role', entity_id: input.id, before, after });
  return after;
}

/** Refused while anyone has it, firm-wide or for a company: they are moved first. */
export async function deleteRole(trx: Transaction<DB>, ctx: ServiceCtx, input: { id: string }) {
  const before = await roleInFirm(trx, ctx.firm_id, input.id);
  const holders = await trx.selectFrom('users').select('full_name')
    .where('custom_role_id', '=', input.id).where('deleted_at', 'is', null).execute();
  const grants = await trx.selectFrom('user_business_access as uba')
    .innerJoin('users as u', 'u.id', 'uba.user_id')
    .select('u.full_name')
    .where('uba.custom_role_id', '=', input.id).where('u.deleted_at', 'is', null).execute();
  const names = [...new Set([...holders, ...grants].map(h => h.full_name))];
  if (names.length > 0) {
    throw new BusinessRuleError(ERR.PRECONDITION_FAILED,
      `${before.name} is in use by ${names.join(', ')}. Give them another role first.`);
  }
  // A deleted login (kept for its history) may still point at it; it no longer matters.
  await trx.updateTable('users').set({ custom_role_id: null }).where('custom_role_id', '=', input.id).execute();
  await trx.updateTable('user_business_access').set({ custom_role_id: null }).where('custom_role_id', '=', input.id).execute();
  await trx.deleteFrom('firm_roles').where('id', '=', input.id).where('firm_id', '=', ctx.firm_id).execute();
  await auditRecord(trx, ctx, { action: AUDIT.ROLE_DELETE, entity_type: 'role', entity_id: input.id, before, after: null });
}
