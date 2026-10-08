import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { AUDIT, ERR } from '@accounting/shared';
import type { DB, UserRole } from '../../db/types.js';
import { AuthError } from '../../lib/errors.js';
import { config } from '../../config.js';
import { verifyPassword } from './passwordHasher.js';
import { decryptField } from '../../lib/fieldCrypto.js';
import { verifyTotp } from './totp.js';
import { revokeSession } from './sessionRevocation.js';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from './tokenService.js';
import { record as auditRecord } from '../audit/auditService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type LoginInput = { email: string; password: string; code?: string | undefined };

// Five wrong tries in a row hold the login for fifteen minutes. A firm admin
// resetting the password lifts the hold.
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
export type ReqMeta = { request_id: string; ip_address: string; user_agent: string };

export type LoginResult = {
  access_token: string;
  refresh_token: string; // raw; API caller is responsible for cookie-setting
  user: { id: string; email: string; full_name: string; role: UserRole; firm_id: string; payroll_access: boolean };
  businesses: Array<{ id: string; name: string; role_override: UserRole | null }>;
};

/** Whether this login may open payroll: a firm admin always, anyone else unless it was switched off. */
export function mayOpenPayroll(user: { role: UserRole; payroll_access: boolean }): boolean {
  return user.role === 'firm_admin' || user.payroll_access;
}

// firm_admins can open any business in the firm (matches resolveBusiness),
// so list them all; other roles only see explicit grants.
export async function businessesForUser(
  trx: Kysely<DB>,
  user: { id: string; firm_id: string; role: UserRole },
): Promise<LoginResult['businesses']> {
  if (user.role === 'firm_admin') {
    return trx
      .selectFrom('businesses as b')
      .leftJoin('user_business_access as uba', (join) =>
        join.onRef('uba.business_id', '=', 'b.id').on('uba.user_id', '=', user.id),
      )
      .select(['b.id', 'b.name', 'uba.role_override'])
      .where('b.firm_id', '=', user.firm_id)
      .where('b.deleted_at', 'is', null)
      .orderBy('b.name')
      .execute();
  }
  return trx
    .selectFrom('user_business_access as uba')
    .innerJoin('businesses as b', 'b.id', 'uba.business_id')
    .select(['b.id', 'b.name', 'uba.role_override'])
    .where('uba.user_id', '=', user.id)
    .where('b.deleted_at', 'is', null)
    .orderBy('b.name')
    .execute();
}

function ctxFromLogin(user: { id: string; firm_id: string; role: UserRole }, meta: ReqMeta): ServiceCtx {
  return {
    user_id: user.id,
    firm_id: user.firm_id,
    business_id: null,
    effective_role: user.role,
    ...meta,
  };
}

export async function login(db: Kysely<DB>, input: LoginInput, meta: ReqMeta): Promise<LoginResult> {
  // Pre-check: load user + verify password OUTSIDE the success transaction so a
  // login_failed audit row is committed independently of the failure throw.
  const preUser = await db
    .selectFrom('users')
    .selectAll()
    .where('email', '=', input.email)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();

  // A login held after too many wrong tries is refused before the password is looked at.
  if (preUser?.locked_until && new Date(preUser.locked_until).getTime() > Date.now()) {
    const minutes = Math.max(1, Math.ceil((new Date(preUser.locked_until).getTime() - Date.now()) / 60000));
    throw new AuthError(ERR.ACCOUNT_LOCKED,
      `Too many wrong tries. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or ask a firm admin to reset the password.`);
  }

  // A wrong password or a wrong code: recorded, counted, and after enough of them the login is held.
  // Committed on its own so it survives the failure thrown after it.
  async function failed(user: NonNullable<typeof preUser>, reason: 'password' | 'code'): Promise<void> {
    const count = user.failed_login_count + 1;
    const lock = count >= MAX_FAILED_LOGINS;
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('users').set({
        failed_login_count: lock ? 0 : count,
        locked_until: lock ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() : null,
      }).where('id', '=', user.id).execute();
      await auditRecord(trx, ctxFromLogin(user, meta), {
        action: AUDIT.AUTH_LOGIN_FAILED,
        entity_type: 'user',
        entity_id: user.id,
        before: null,
        after: { email: input.email, reason, locked: lock },
      });
    });
  }

  if (!preUser || !(await verifyPassword(input.password, preUser.password_hash))) {
    // If the user is unknown there is no firm to attribute the attempt to
    // (audit_logs.firm_id is NOT NULL), so nothing is recorded for it.
    if (preUser) await failed(preUser, 'password');
    throw new AuthError(ERR.INVALID_CREDENTIALS, 'Invalid email or password');
  }

  // Said only to someone who knows the password.
  if (preUser.deactivated_at) {
    throw new AuthError(ERR.FORBIDDEN, 'This login has been switched off. Ask a firm admin.');
  }

  if (preUser.totp_enabled_at && preUser.totp_secret) {
    if (!input.code) {
      throw new AuthError(ERR.TWO_STEP_REQUIRED, 'Enter the 6-digit code from your authenticator app.');
    }
    if (!verifyTotp(decryptField(preUser.totp_secret), input.code)) {
      await failed(preUser, 'code');
      throw new AuthError(ERR.INVALID_CREDENTIALS, 'That code is not right. Check the app and try again.');
    }
  }

  return db.transaction().execute(async (trx) => {
    const user = preUser;

    const raw = generateRefreshToken();
    const token_hash = await hashRefreshToken(raw);
    const expires_at = new Date(Date.now() + config.JWT_REFRESH_TTL_DAYS * 24 * 3600 * 1000);
    const session = await trx.insertInto('refresh_tokens').values({
      user_id: user.id, token_hash, expires_at: expires_at.toISOString() as unknown as string,
      user_agent: meta.user_agent || null, ip_address: meta.ip_address || null,
    }).returning('session_id').executeTakeFirstOrThrow();

    await trx.updateTable('users').set({ last_login_at: sql`now()`, failed_login_count: 0, locked_until: null })
      .where('id', '=', user.id).execute();

    const businesses = await businessesForUser(trx, user);

    await auditRecord(trx, ctxFromLogin(user, meta), {
      action: AUDIT.AUTH_LOGIN,
      entity_type: 'user',
      entity_id: user.id,
      before: null,
      after: { email: user.email },
    });

    return {
      access_token: signAccessToken({ user_id: user.id, firm_id: user.firm_id, role: user.role, sid: session.session_id }),
      refresh_token: raw,
      user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role, firm_id: user.firm_id, payroll_access: mayOpenPayroll(user) },
      businesses,
    };
  });
}

export async function refresh(db: Kysely<DB>, rawRefreshToken: string, meta: ReqMeta): Promise<LoginResult> {
  return db.transaction().execute(async (trx) => {
    const token_hash = await hashRefreshToken(rawRefreshToken);
    const row = await trx
      .selectFrom('refresh_tokens')
      .selectAll()
      .where('token_hash', '=', token_hash)
      .executeTakeFirst();
    if (!row || row.revoked_at !== null || new Date(row.expires_at).getTime() < Date.now()) {
      throw new AuthError(ERR.TOKEN_EXPIRED, 'Refresh token invalid or expired');
    }
    const user = await trx.selectFrom('users').selectAll().where('id', '=', row.user_id).where('deleted_at', 'is', null).executeTakeFirst();
    if (!user) throw new AuthError(ERR.UNAUTHORIZED, 'User no longer exists');
    if (user.deactivated_at) throw new AuthError(ERR.UNAUTHORIZED, 'This login has been switched off');

    // rotate: the new token is the same session, so it keeps when the person signed in.
    await trx.updateTable('refresh_tokens').set({ revoked_at: sql`now()` }).where('id', '=', row.id).execute();
    const newRaw = generateRefreshToken();
    const newHash = await hashRefreshToken(newRaw);
    const expires_at = new Date(Date.now() + config.JWT_REFRESH_TTL_DAYS * 24 * 3600 * 1000);
    await trx.insertInto('refresh_tokens').values({
      user_id: user.id, token_hash: newHash, expires_at: expires_at.toISOString() as unknown as string,
      session_id: row.session_id,
      session_started_at: row.session_started_at,
      user_agent: meta.user_agent || row.user_agent, ip_address: meta.ip_address || row.ip_address,
    }).execute();

    const businesses = await businessesForUser(trx, user);

    await auditRecord(trx, ctxFromLogin(user, meta), {
      action: AUDIT.AUTH_REFRESH,
      entity_type: 'user',
      entity_id: user.id,
      before: null,
      after: null,
    });

    return {
      access_token: signAccessToken({ user_id: user.id, firm_id: user.firm_id, role: user.role, sid: row.session_id }),
      refresh_token: newRaw,
      user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role, firm_id: user.firm_id, payroll_access: mayOpenPayroll(user) },
      businesses,
    };
  });
}

export async function logout(db: Kysely<DB>, rawRefreshToken: string, meta: ReqMeta): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const token_hash = await hashRefreshToken(rawRefreshToken);
    const row = await trx.selectFrom('refresh_tokens').selectAll().where('token_hash', '=', token_hash).executeTakeFirst();
    if (!row || row.revoked_at !== null) return; // idempotent
    await trx.updateTable('refresh_tokens').set({ revoked_at: sql`now()` }).where('id', '=', row.id).execute();
    // The access token this browser still holds stops counting now, not when it expires.
    revokeSession(row.session_id);
    const user = await trx.selectFrom('users').selectAll().where('id', '=', row.user_id).executeTakeFirst();
    if (user) {
      await auditRecord(trx, ctxFromLogin(user, meta), {
        action: AUDIT.AUTH_LOGOUT,
        entity_type: 'user',
        entity_id: user.id,
        before: null,
        after: null,
      });
    }
  });
}
