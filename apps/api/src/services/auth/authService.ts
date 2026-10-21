import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { AUDIT, ERR } from '@accounting/shared';
import type { DB, UserRole } from '../../db/types.js';
import { AuthError } from '../../lib/errors.js';
import { hashPassword, verifyPassword } from './passwordHasher.js';
import { decryptField } from '../../lib/fieldCrypto.js';
import { totpStep } from './totp.js';
import { revokeSession } from './sessionRevocation.js';
import { generateRefreshToken, hashRefreshToken, signAccessToken, type RefreshTokenType, type SetupStep } from './tokenService.js';
import { config } from '../../config.js';
import { record as auditRecord } from '../audit/auditService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type LoginInput = { email: string; password: string; code?: string | undefined };

// Five wrong tries in a row hold the login for fifteen minutes. A firm admin
// resetting the password lifts the hold.
export const MAX_FAILED_LOGINS = 5;

// Checked against when the email is unknown, so a wrong email takes as long to
// answer as a wrong password and the timing does not tell which emails have logins.
let stubHash: Promise<string> | null = null;
function unknownEmailHash(): Promise<string> {
  stubHash ??= hashPassword(`no login has this password ${Math.random()}`);
  return stubHash;
}
export const LOCK_MINUTES = 15;
export type ReqMeta = { request_id: string; ip_address: string; user_agent: string };

// How long a browser session lasts (security review 2026-10-21). It is renewed
// while the person uses the app, and ends after the firm's idle limit with
// nothing done (idle_sign_out_minutes, an hour unless changed), or 12 hours
// after signing in, whichever comes first; then the password (and code) again.
// The mobile app's sessions last JWT_MOBILE_REFRESH_TTL_DAYS without use (30
// unless set): the phone's own lock guards it in between, and signing in on a
// phone every hour would not be used.
export const MAX_SESSION_HOURS = 12;
// A sign-in key (refresh token) replaced more than this long ago and then used
// again was copied: the session it belongs to is ended. Two tabs renewing at
// the same moment fall inside it, and are only refused.
const REUSE_GRACE_MS = 60 * 1000;

/** When a refresh token issued now stops working: for a browser, the idle limit or the session limit, the sooner. */
function refreshExpiry(type: RefreshTokenType, sessionStartedAt: Date, idleMinutes: number, now = Date.now()): Date {
  if (type === 'mobile') return new Date(now + config.JWT_MOBILE_REFRESH_TTL_DAYS * 24 * 3600_000);
  return new Date(Math.min(now + idleMinutes * 60_000, sessionStartedAt.getTime() + MAX_SESSION_HOURS * 3600_000));
}

/** The firm's sign-in settings (migration 0109). */
export async function firmSignInSettings(
  db: Kysely<DB>, firm_id: string,
): Promise<{ require_two_step: boolean; idle_sign_out_minutes: number }> {
  return db.selectFrom('firms').select(['require_two_step', 'idle_sign_out_minutes'])
    .where('id', '=', firm_id).executeTakeFirstOrThrow();
}

/** What the login must do before the app opens to it. */
export function setupSteps(
  user: { must_change_password: boolean; totp_enabled_at: unknown },
  firm: { require_two_step: boolean },
): SetupStep[] {
  const steps: SetupStep[] = [];
  if (user.must_change_password) steps.push('password');
  if (firm.require_two_step && !user.totp_enabled_at) steps.push('two_step');
  return steps;
}

export type LoginResult = {
  access_token: string;
  refresh_token: string; // raw; API caller is responsible for cookie-setting
  /** When the refresh token stops working, for the cookie's lifetime. */
  refresh_expires_at: Date;
  user: {
    id: string; email: string; full_name: string; role: UserRole; firm_id: string; payroll_access: boolean;
    /** Steps left before the app opens; empty when there are none. */
    setup_required: SetupStep[];
    /** The browser signs out after this long with nothing done. */
    idle_sign_out_minutes: number;
  };
  /** `fiscal_year_start_month` (1 to 12) is what "This year" means for that company. */
  businesses: Array<{ id: string; name: string; role_override: UserRole | null; fiscal_year_start_month: number }>;
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
      .select(['b.id', 'b.name', 'uba.role_override', 'b.fiscal_year_start_month'])
      .where('b.firm_id', '=', user.firm_id)
      .where('b.deleted_at', 'is', null)
      .orderBy('b.name')
      .execute();
  }
  return trx
    .selectFrom('user_business_access as uba')
    .innerJoin('businesses as b', 'b.id', 'uba.business_id')
    .select(['b.id', 'b.name', 'uba.role_override', 'b.fiscal_year_start_month'])
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

export async function login(
  db: Kysely<DB>, input: LoginInput, meta: ReqMeta, tokenType: RefreshTokenType = 'web',
): Promise<LoginResult> {
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

  const passwordOk = preUser
    ? await verifyPassword(input.password, preUser.password_hash)
    : (await verifyPassword(input.password, await unknownEmailHash()), false);
  if (!preUser || !passwordOk) {
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
    const step = totpStep(decryptField(preUser.totp_secret), input.code);
    // A code is good once: its step must come after the last one accepted. The
    // check and the save are one statement, so two sign-ins with one code cannot both pass.
    const taken = step === null ? undefined : await db.updateTable('users').set({ totp_last_step: step })
      .where('id', '=', preUser.id)
      .where(eb => eb.or([eb('totp_last_step', 'is', null), eb('totp_last_step', '<', String(step))]))
      .returning('id').executeTakeFirst();
    if (!taken) {
      await failed(preUser, 'code');
      throw new AuthError(ERR.INVALID_CREDENTIALS, step === null
        ? 'That code is not right. Check the app and try again.'
        : 'That code was already used. Wait for the next one.');
    }
  }

  const firm = await firmSignInSettings(db, preUser.firm_id);

  return db.transaction().execute(async (trx) => {
    const user = preUser;

    const raw = generateRefreshToken();
    const token_hash = await hashRefreshToken(raw);
    const expires_at = refreshExpiry(tokenType, new Date(), firm.idle_sign_out_minutes);
    const session = await trx.insertInto('refresh_tokens').values({
      user_id: user.id, token_hash, expires_at: expires_at.toISOString() as unknown as string,
      user_agent: meta.user_agent || null, ip_address: meta.ip_address || null, token_type: tokenType,
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

    const setup = setupSteps(user, firm);
    return {
      access_token: signAccessToken({
        user_id: user.id, firm_id: user.firm_id, role: user.role, sid: session.session_id, ...(setup.length ? { setup } : {}),
      }),
      refresh_token: raw,
      refresh_expires_at: expires_at,
      user: {
        id: user.id, email: user.email, full_name: user.full_name, role: user.role, firm_id: user.firm_id,
        payroll_access: mayOpenPayroll(user), setup_required: setup, idle_sign_out_minutes: firm.idle_sign_out_minutes,
      },
      businesses,
    };
  });
}

/**
 * A sign-in key that was replaced a while ago has come back: someone kept a
 * copy. The session it belongs to is ended, so neither the copy nor the
 * browser (or phone) it was taken from can carry on; the person signs in again.
 * Committed on its own, as the refusal that follows rolls back.
 */
async function endCopiedSession(db: Kysely<DB>, row: { user_id: string; session_id: string }, meta: ReqMeta): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const ended = await trx.updateTable('refresh_tokens').set({ revoked_at: sql`now()` })
      .where('session_id', '=', row.session_id).where('revoked_at', 'is', null)
      .returning('id').execute();
    if (ended.length === 0) return; // already signed out: nothing left to end
    revokeSession(row.session_id);
    const user = await trx.selectFrom('users').selectAll().where('id', '=', row.user_id).executeTakeFirst();
    if (user) {
      await auditRecord(trx, ctxFromLogin(user, meta), {
        action: AUDIT.AUTH_REFRESH_REUSE, entity_type: 'user', entity_id: user.id, before: null,
        after: { session_id: row.session_id },
      });
    }
  });
}

export async function refresh(
  db: Kysely<DB>, rawRefreshToken: string, meta: ReqMeta, expectedTokenType: RefreshTokenType = 'web',
): Promise<LoginResult> {
  const token_hash = await hashRefreshToken(rawRefreshToken);
  const replaced = await db.selectFrom('refresh_tokens').select(['user_id', 'session_id', 'revoked_at'])
    .where('token_hash', '=', token_hash).executeTakeFirst();
  if (replaced?.revoked_at && Date.now() - new Date(replaced.revoked_at).getTime() > REUSE_GRACE_MS) {
    await endCopiedSession(db, replaced, meta);
  }

  return db.transaction().execute(async (trx) => {
    // Locked, so two renewals with one key cannot both pass: the second waits, then finds it replaced.
    const row = await trx
      .selectFrom('refresh_tokens')
      .selectAll()
      .where('token_hash', '=', token_hash)
      .forUpdate()
      .executeTakeFirst();
    if (!row || row.revoked_at !== null || new Date(row.expires_at).getTime() < Date.now()) {
      throw new AuthError(ERR.TOKEN_EXPIRED, 'Refresh token invalid or expired');
    }
    // A mobile token can only be refreshed through the mobile route and vice
    // versa — otherwise a web cookie value replayed into the mobile body
    // route (or the reverse) would silently inherit the wrong TTL.
    if (row.token_type !== expectedTokenType) {
      throw new AuthError(ERR.TOKEN_EXPIRED, 'Refresh token invalid or expired');
    }
    const user = await trx.selectFrom('users').selectAll().where('id', '=', row.user_id).where('deleted_at', 'is', null).executeTakeFirst();
    if (!user) throw new AuthError(ERR.UNAUTHORIZED, 'User no longer exists');
    if (user.deactivated_at) throw new AuthError(ERR.UNAUTHORIZED, 'This login has been switched off');

    // A browser left alone past the firm's limit, or signed in too long ago: the session
    // is over. Checked here as well as by expires_at, which a token from before these
    // limits does not carry. The mobile app has its own lifetime (refreshExpiry).
    const firm = await firmSignInSettings(trx, user.firm_id);
    const startedAt = new Date(row.session_started_at);
    const idleMs = Date.now() - new Date(row.created_at as unknown as string).getTime();
    if (row.token_type === 'web'
      && (idleMs > firm.idle_sign_out_minutes * 60_000 || Date.now() - startedAt.getTime() > MAX_SESSION_HOURS * 3600_000)) {
      throw new AuthError(ERR.TOKEN_EXPIRED, 'The session has ended. Sign in again.');
    }

    // rotate: the new token is the same session, so it keeps when the person signed in.
    await trx.updateTable('refresh_tokens').set({ revoked_at: sql`now()` }).where('id', '=', row.id).execute();
    const newRaw = generateRefreshToken();
    const newHash = await hashRefreshToken(newRaw);
    const expires_at = refreshExpiry(row.token_type, startedAt, firm.idle_sign_out_minutes);
    await trx.insertInto('refresh_tokens').values({
      user_id: user.id, token_hash: newHash, expires_at: expires_at.toISOString() as unknown as string,
      session_id: row.session_id,
      session_started_at: row.session_started_at,
      user_agent: meta.user_agent || row.user_agent, ip_address: meta.ip_address || row.ip_address,
      token_type: row.token_type,
    }).execute();

    const businesses = await businessesForUser(trx, user);

    await auditRecord(trx, ctxFromLogin(user, meta), {
      action: AUDIT.AUTH_REFRESH,
      entity_type: 'user',
      entity_id: user.id,
      before: null,
      after: null,
    });

    // Worked out afresh, so a renewal after a step is done opens the app.
    const setup = setupSteps(user, firm);
    return {
      access_token: signAccessToken({
        user_id: user.id, firm_id: user.firm_id, role: user.role, sid: row.session_id, ...(setup.length ? { setup } : {}),
      }),
      refresh_token: newRaw,
      refresh_expires_at: expires_at,
      user: {
        id: user.id, email: user.email, full_name: user.full_name, role: user.role, firm_id: user.firm_id,
        payroll_access: mayOpenPayroll(user), setup_required: setup, idle_sign_out_minutes: firm.idle_sign_out_minutes,
      },
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
