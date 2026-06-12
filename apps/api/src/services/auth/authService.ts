import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { AUDIT, ERR } from '@accounting/shared';
import type { DB, UserRole } from '../../db/types.js';
import { AuthError } from '../../lib/errors.js';
import { config } from '../../config.js';
import { verifyPassword } from './passwordHasher.js';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from './tokenService.js';
import { record as auditRecord } from '../audit/auditService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type LoginInput = { email: string; password: string };
export type ReqMeta = { request_id: string; ip_address: string; user_agent: string };

export type LoginResult = {
  access_token: string;
  refresh_token: string; // raw; API caller is responsible for cookie-setting
  user: { id: string; email: string; full_name: string; role: UserRole; firm_id: string };
  businesses: Array<{ id: string; name: string; role_override: UserRole | null }>;
};

// firm_admins can open any business in the firm (matches resolveBusiness),
// so list them all; other roles only see explicit grants.
async function businessesForUser(
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

  if (!preUser || !(await verifyPassword(input.password, preUser.password_hash))) {
    // Log attempt with whatever ctx we can reconstruct. If user unknown, firm_id is null —
    // audit_logs.firm_id is NOT NULL, so for login_failed on unknown users we skip the
    // audit write (can't attribute to a firm).
    if (preUser) {
      await db.transaction().execute(async (trx) => {
        await auditRecord(trx, ctxFromLogin(preUser, meta), {
          action: AUDIT.AUTH_LOGIN_FAILED,
          entity_type: 'user',
          entity_id: preUser.id,
          before: null,
          after: { email: input.email },
        });
      });
    }
    throw new AuthError(ERR.INVALID_CREDENTIALS, 'Invalid email or password');
  }

  return db.transaction().execute(async (trx) => {
    const user = preUser;

    const raw = generateRefreshToken();
    const token_hash = await hashRefreshToken(raw);
    const expires_at = new Date(Date.now() + config.JWT_REFRESH_TTL_DAYS * 24 * 3600 * 1000);
    await trx.insertInto('refresh_tokens').values({
      user_id: user.id, token_hash, expires_at: expires_at.toISOString() as unknown as string,
    }).execute();

    await trx.updateTable('users').set({ last_login_at: sql`now()` }).where('id', '=', user.id).execute();

    const businesses = await businessesForUser(trx, user);

    await auditRecord(trx, ctxFromLogin(user, meta), {
      action: AUDIT.AUTH_LOGIN,
      entity_type: 'user',
      entity_id: user.id,
      before: null,
      after: { email: user.email },
    });

    return {
      access_token: signAccessToken({ user_id: user.id, firm_id: user.firm_id, role: user.role }),
      refresh_token: raw,
      user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role, firm_id: user.firm_id },
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

    // rotate
    await trx.updateTable('refresh_tokens').set({ revoked_at: sql`now()` }).where('id', '=', row.id).execute();
    const newRaw = generateRefreshToken();
    const newHash = await hashRefreshToken(newRaw);
    const expires_at = new Date(Date.now() + config.JWT_REFRESH_TTL_DAYS * 24 * 3600 * 1000);
    await trx.insertInto('refresh_tokens').values({
      user_id: user.id, token_hash: newHash, expires_at: expires_at.toISOString() as unknown as string,
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
      access_token: signAccessToken({ user_id: user.id, firm_id: user.firm_id, role: user.role }),
      refresh_token: newRaw,
      user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role, firm_id: user.firm_id },
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
