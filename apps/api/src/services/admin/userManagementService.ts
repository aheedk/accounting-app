import { randomBytes } from 'node:crypto';
import { sql, type Kysely, type Transaction } from 'kysely';
import { AUDIT, ERR } from '@accounting/shared';
import type { DB, UserRole } from '../../db/types.js';
import { BusinessRuleError, NotFoundError } from '../../lib/errors.js';
import { hashPassword } from '../auth/passwordHasher.js';
import { endSessions, reissueAccessTokens } from '../auth/accountService.js';
import { firmSignInSettings } from '../auth/authService.js';
import { record as auditRecord } from '../audit/auditService.js';
import type { ServiceCtx } from '../../lib/ctx.js';
import { roleInFirm } from './roleService.js';

export type UserBusinessAccess = {
  business_id: string;
  business_name: string;
  role_override: UserRole | null;
  /** One of the firm's own roles for this company (docs/specs/2026-11-09-custom-roles-design.md). */
  custom_role: { id: string; name: string } | null;
};

export type ListedUser = {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  custom_role: { id: string; name: string } | null;
  last_login_at: unknown;
  created_at: unknown;
  deactivated_at: unknown;
  locked: boolean;
  two_step_enabled: boolean;
  payroll_access: boolean;
  business_access: UserBusinessAccess[];
};

export async function listUsers(db: Kysely<DB>, firm_id: string): Promise<ListedUser[]> {
  const users = await db.selectFrom('users')
    .leftJoin('firm_roles as fr', 'fr.id', 'users.custom_role_id')
    .select(['users.id', 'email', 'full_name', 'role', 'last_login_at', 'users.created_at', 'deactivated_at', 'locked_until', 'totp_enabled_at', 'payroll_access', 'fr.id as custom_role_id', 'fr.name as custom_role_name'])
    .where('users.firm_id', '=', firm_id)
    .where('deleted_at', 'is', null)
    .orderBy('users.created_at', 'asc')
    .execute();
  if (users.length === 0) return [];

  const userIds = users.map(u => u.id);
  const accessRows = await db.selectFrom('user_business_access as uba')
    .innerJoin('businesses as b', 'b.id', 'uba.business_id')
    .leftJoin('firm_roles as fr', 'fr.id', 'uba.custom_role_id')
    .select([
      'uba.user_id', 'uba.business_id', 'uba.role_override',
      'b.name as business_name', 'fr.id as custom_role_id', 'fr.name as custom_role_name',
    ])
    .where('uba.user_id', 'in', userIds)
    .where('b.deleted_at', 'is', null)
    .execute();

  const byUser = new Map<string, UserBusinessAccess[]>();
  for (const r of accessRows) {
    const list = byUser.get(r.user_id) ?? [];
    list.push({
      business_id: r.business_id,
      business_name: r.business_name,
      role_override: r.role_override,
      custom_role: r.custom_role_id && r.custom_role_name ? { id: r.custom_role_id, name: r.custom_role_name } : null,
    });
    byUser.set(r.user_id, list);
  }

  return users.map(u => ({
    id: u.id,
    email: u.email,
    full_name: u.full_name,
    role: u.role,
    // One of the firm's own roles, when the login has one (it is then stored as staff).
    custom_role: u.custom_role_id && u.custom_role_name ? { id: u.custom_role_id, name: u.custom_role_name } : null,
    last_login_at: u.last_login_at,
    created_at: u.created_at,
    // A login that is switched off stays in the list, so it can be switched back on.
    deactivated_at: u.deactivated_at,
    locked: u.locked_until !== null && new Date(u.locked_until).getTime() > Date.now(),
    two_step_enabled: u.totp_enabled_at !== null,
    // A firm admin always has payroll, whatever the switch says.
    payroll_access: u.role === 'firm_admin' || u.payroll_access,
    business_access: byUser.get(u.id) ?? [],
  }));
}

function generateTempPassword(): string {
  // 16-char base64url — ~96 bits of entropy.
  return randomBytes(12).toString('base64url');
}

export async function createUser(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: { firm_id: string; email: string; full_name: string; role: UserRole; custom_role_id?: string | null | undefined },
) {
  // A login with one of the firm's own roles is stored as staff (migration 0116).
  if (input.custom_role_id) await roleInFirm(trx, ctx.firm_id, input.custom_role_id);
  const role: UserRole = input.custom_role_id ? 'staff' : input.role;
  const dup = await trx.selectFrom('users')
    .select('id')
    .where('firm_id', '=', input.firm_id)
    .where('email', '=', input.email)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (dup) {
    throw new BusinessRuleError(ERR.DUPLICATE_RESOURCE, `User with email ${input.email} already exists`);
  }

  const plaintext = generateTempPassword();
  const password_hash = await hashPassword(plaintext);

  // The firm admin sees this password, so the person replaces it before the app opens.
  const row = await trx.insertInto('users').values({
    firm_id: input.firm_id,
    email: input.email,
    password_hash,
    full_name: input.full_name,
    role,
    custom_role_id: input.custom_role_id ?? null,
    must_change_password: true,
  }).returning(['id', 'email', 'full_name', 'role', 'custom_role_id', 'firm_id', 'created_at'])
    .executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.USER_CREATE,
    entity_type: 'user',
    entity_id: row.id,
    before: null,
    after: { id: row.id, email: row.email, full_name: row.full_name, role: row.role, custom_role_id: row.custom_role_id, firm_id: row.firm_id },
  });

  return { user: row, plaintext_password: plaintext };
}

export async function updateUserRole(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: { user_id: string; role: UserRole; custom_role_id?: string | null | undefined },
) {
  if (input.custom_role_id) await roleInFirm(trx, ctx.firm_id, input.custom_role_id);
  const before = await trx.selectFrom('users')
    .select(['id', 'email', 'full_name', 'role', 'custom_role_id', 'firm_id'])
    .where('id', '=', input.user_id)
    .where('firm_id', '=', ctx.firm_id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!before) throw new NotFoundError('user', input.user_id);

  // A custom role is stored with the role staff (migration 0116).
  const role: UserRole = input.custom_role_id ? 'staff' : input.role;
  const updated = await trx.updateTable('users')
    .set({ role, custom_role_id: input.custom_role_id ?? null })
    .where('id', '=', input.user_id)
    .returning(['id', 'email', 'full_name', 'role', 'custom_role_id', 'firm_id'])
    .executeTakeFirstOrThrow();
  // The role travels in the access token: without this, a firm admin made staff
  // kept firm-admin powers (and every client of the firm) until it expired. A new
  // custom role does not change the token, but renewing redraws the person's menu.
  if (before.role !== updated.role || before.custom_role_id !== updated.custom_role_id) {
    await reissueAccessTokens(trx, input.user_id);
  }

  await auditRecord(trx, ctx, {
    action: AUDIT.USER_UPDATE,
    entity_type: 'user',
    entity_id: input.user_id,
    before,
    after: updated,
  });
  return updated;
}

export async function grantBusinessAccess(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: { user_id: string; business_id: string; role_override: UserRole | null; custom_role_id?: string | null | undefined },
) {
  if (input.role_override && input.custom_role_id) {
    throw new BusinessRuleError(ERR.VALIDATION_FAILED, 'Give either a built-in role or a custom role, not both.');
  }
  if (input.custom_role_id) await roleInFirm(trx, ctx.firm_id, input.custom_role_id);
  const user = await trx.selectFrom('users')
    .select(['id', 'firm_id'])
    .where('id', '=', input.user_id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!user || user.firm_id !== ctx.firm_id) throw new NotFoundError('user', input.user_id);

  const biz = await trx.selectFrom('businesses')
    .select(['id', 'firm_id'])
    .where('id', '=', input.business_id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!biz || biz.firm_id !== ctx.firm_id) throw new NotFoundError('business', input.business_id);

  const existing = await trx.selectFrom('user_business_access')
    .select('id')
    .where('user_id', '=', input.user_id)
    .where('business_id', '=', input.business_id)
    .executeTakeFirst();
  if (existing) {
    throw new BusinessRuleError(ERR.DUPLICATE_RESOURCE, 'User already has access to this business');
  }

  const row = await trx.insertInto('user_business_access').values({
    user_id: input.user_id,
    business_id: input.business_id,
    role_override: input.role_override,
    custom_role_id: input.custom_role_id ?? null,
  }).returningAll().executeTakeFirstOrThrow();
  // The person's list of companies, and the role in each, comes with the session.
  await reissueAccessTokens(trx, input.user_id);

  await auditRecord(trx, ctx, {
    action: AUDIT.USER_BUSINESS_ACCESS_GRANT,
    entity_type: 'user_business_access',
    entity_id: row.id,
    before: null,
    after: row,
  });
  return row;
}

export async function revokeBusinessAccess(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: { user_id: string; business_id: string },
) {
  const user = await trx.selectFrom('users')
    .select(['id', 'firm_id'])
    .where('id', '=', input.user_id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!user || user.firm_id !== ctx.firm_id) throw new NotFoundError('user', input.user_id);

  const before = await trx.selectFrom('user_business_access')
    .selectAll()
    .where('user_id', '=', input.user_id)
    .where('business_id', '=', input.business_id)
    .executeTakeFirst();
  if (!before) throw new NotFoundError('user_business_access', `${input.user_id}/${input.business_id}`);

  await trx.deleteFrom('user_business_access')
    .where('user_id', '=', input.user_id)
    .where('business_id', '=', input.business_id)
    .execute();

  await auditRecord(trx, ctx, {
    action: AUDIT.USER_BUSINESS_ACCESS_REVOKE,
    entity_type: 'user_business_access',
    entity_id: before.id,
    before,
    after: null,
  });
}

// ── Switching a login off, and the things a firm admin does when someone is
// locked out. Spec: docs/specs/2026-10-08-accounts-and-roles-design.md

async function userInFirm(trx: Transaction<DB>, ctx: ServiceCtx, user_id: string) {
  const user = await trx.selectFrom('users')
    .select(['id', 'email', 'full_name', 'role', 'firm_id', 'deactivated_at'])
    .where('id', '=', user_id).where('firm_id', '=', ctx.firm_id).where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!user) throw new NotFoundError('user', user_id);
  return user;
}

/**
 * Switches a login off: the person cannot sign in and every session they have
 * ends now. Their name stays on everything they did. Not yourself, and not the
 * last firm admin, so a firm can never be left with nobody able to manage it.
 */
export async function deactivateUser(trx: Transaction<DB>, ctx: ServiceCtx, input: { user_id: string }) {
  const user = await userInFirm(trx, ctx, input.user_id);
  if (user.id === ctx.user_id) throw new BusinessRuleError(ERR.PRECONDITION_FAILED, 'You cannot switch off your own login.');
  if (user.deactivated_at) return user;
  if (user.role === 'firm_admin') {
    const others = await trx.selectFrom('users').select('id')
      .where('firm_id', '=', ctx.firm_id).where('role', '=', 'firm_admin')
      .where('deleted_at', 'is', null).where('deactivated_at', 'is', null).where('id', '<>', user.id)
      .execute();
    if (others.length === 0) throw new BusinessRuleError(ERR.PRECONDITION_FAILED, 'This is the only firm admin. Make someone else a firm admin first.');
  }
  await trx.updateTable('users').set({ deactivated_at: sql`now()` }).where('id', '=', user.id).execute();
  await endSessions(trx, { user_id: user.id });
  await auditRecord(trx, ctx, {
    action: AUDIT.USER_DEACTIVATE, entity_type: 'user', entity_id: user.id, before: { active: true }, after: { active: false },
  });
  return { ...user, deactivated_at: new Date() };
}

export async function reactivateUser(trx: Transaction<DB>, ctx: ServiceCtx, input: { user_id: string }) {
  const user = await userInFirm(trx, ctx, input.user_id);
  if (!user.deactivated_at) return user;
  await trx.updateTable('users').set({ deactivated_at: null, failed_login_count: 0, locked_until: null })
    .where('id', '=', user.id).execute();
  await auditRecord(trx, ctx, {
    action: AUDIT.USER_REACTIVATE, entity_type: 'user', entity_id: user.id, before: { active: false }, after: { active: true },
  });
  return { ...user, deactivated_at: null };
}

/**
 * Gives a login a new one-time password, shown once to the firm admin to pass
 * on; the person must choose their own at their next sign-in, before the app
 * opens. Lifts a hold from wrong tries and ends the person's sessions. There is
 * no emailed reset link because the app has no mail service.
 */
export async function resetUserPassword(trx: Transaction<DB>, ctx: ServiceCtx, input: { user_id: string }) {
  const user = await userInFirm(trx, ctx, input.user_id);
  const plaintext = generateTempPassword();
  await trx.updateTable('users')
    .set({ password_hash: await hashPassword(plaintext), failed_login_count: 0, locked_until: null, must_change_password: true })
    .where('id', '=', user.id).execute();
  await endSessions(trx, { user_id: user.id });
  await auditRecord(trx, ctx, {
    action: AUDIT.USER_PASSWORD_RESET, entity_type: 'user', entity_id: user.id, before: null, after: { email: user.email },
  });
  return { user, plaintext_password: plaintext };
}

/** Signs a user out of every browser. */
export async function signOutUser(trx: Transaction<DB>, ctx: ServiceCtx, input: { user_id: string }) {
  const user = await userInFirm(trx, ctx, input.user_id);
  const ended = await endSessions(trx, { user_id: user.id });
  await auditRecord(trx, ctx, {
    action: AUDIT.USER_SIGN_OUT, entity_type: 'user', entity_id: user.id, before: null, after: { ended },
  });
  return { ended };
}

/**
 * Turns the second step off for someone who has lost the phone it was on.
 * Also ends their sessions, like resetUserPassword: the phone being lost is
 * reason enough to assume whoever has it might also be signed in right now.
 */
export async function resetUserTwoStep(trx: Transaction<DB>, ctx: ServiceCtx, input: { user_id: string }) {
  const user = await userInFirm(trx, ctx, input.user_id);
  await trx.updateTable('users').set({ totp_secret: null, totp_enabled_at: null, totp_last_step: null }).where('id', '=', user.id).execute();
  await endSessions(trx, { user_id: user.id });
  await auditRecord(trx, ctx, {
    action: AUDIT.USER_TWO_STEP_RESET, entity_type: 'user', entity_id: user.id, before: null, after: { email: user.email },
  });
  return { ok: true };
}

/** Opens or closes payroll for a login. A firm admin always has it, so there is nothing to switch. */
export async function setPayrollAccess(trx: Transaction<DB>, ctx: ServiceCtx, input: { user_id: string; allowed: boolean }) {
  const user = await userInFirm(trx, ctx, input.user_id);
  if (user.role === 'firm_admin') {
    throw new BusinessRuleError(ERR.PRECONDITION_FAILED, 'A firm admin always has payroll.');
  }
  const before = await trx.selectFrom('users').select('payroll_access').where('id', '=', user.id).executeTakeFirstOrThrow();
  await trx.updateTable('users').set({ payroll_access: input.allowed }).where('id', '=', user.id).execute();
  await auditRecord(trx, ctx, {
    action: AUDIT.USER_UPDATE, entity_type: 'user', entity_id: user.id,
    before: { payroll_access: before.payroll_access }, after: { payroll_access: input.allowed },
  });
  return { payroll_access: input.allowed };
}

// ── The firm's sign-in settings ──────────────────────────────────────────────
// Set by a firm admin for every login of the firm (security review 2026-10-21):
// whether everyone must set up the second step, and how long a browser may be
// left alone before it is signed out. Spec:
// docs/specs/2026-10-08-accounts-and-roles-design.md, "Firm security settings".

export async function getFirmSecurity(db: Kysely<DB>, firm_id: string) {
  return firmSignInSettings(db, firm_id);
}

export async function updateFirmSecurity(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: { require_two_step?: boolean | undefined; idle_sign_out_minutes?: number | undefined },
) {
  const before = await firmSignInSettings(trx, ctx.firm_id);
  if (input.require_two_step && !before.require_two_step) {
    const me = await trx.selectFrom('users').select('totp_enabled_at').where('id', '=', ctx.user_id).executeTakeFirstOrThrow();
    if (!me.totp_enabled_at) {
      throw new BusinessRuleError(ERR.PRECONDITION_FAILED,
        'Turn on your own second step first (My account), so requiring it cannot lock you out.');
    }
  }
  const patch = {
    ...(input.require_two_step !== undefined ? { require_two_step: input.require_two_step } : {}),
    ...(input.idle_sign_out_minutes !== undefined ? { idle_sign_out_minutes: input.idle_sign_out_minutes } : {}),
  };
  if (Object.keys(patch).length === 0) return before;
  await trx.updateTable('firms').set(patch).where('id', '=', ctx.firm_id).execute();
  const after = await firmSignInSettings(trx, ctx.firm_id);
  await auditRecord(trx, ctx, {
    action: AUDIT.FIRM_SECURITY_UPDATE, entity_type: 'firm', entity_id: ctx.firm_id, before, after,
  });
  return after;
}
