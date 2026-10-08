import { type Kysely, sql, type Transaction } from 'kysely';
import { AUDIT, ERR } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import { BusinessRuleError, NotFoundError } from '../../lib/errors.js';
import { decryptField, encryptField } from '../../lib/fieldCrypto.js';
import { record as auditRecord } from '../audit/auditService.js';
import type { ServiceCtx } from '../../lib/ctx.js';
import { hashPassword, verifyPassword } from './passwordHasher.js';
import { revokeAccessTokensBefore, revokeSession } from './sessionRevocation.js';
import { generateTotpSecret, otpauthUri, verifyTotp } from './totp.js';

// What a signed-in person does to their own login: change the password, see
// and end their sessions, and turn the second step of signing in on or off.
// Spec: docs/specs/2026-10-08-accounts-and-roles-design.md

const ISSUER = 'Accounting';

async function loadUser(trx: Transaction<DB>, ctx: ServiceCtx) {
  const user = await trx.selectFrom('users').selectAll()
    .where('id', '=', ctx.user_id).where('deleted_at', 'is', null).executeTakeFirst();
  if (!user) throw new NotFoundError('user', ctx.user_id);
  return user;
}

/**
 * Ends a user's sessions, at once: their refresh tokens are revoked and the
 * access tokens of those sessions stop counting. `keep_token_hash` spares one
 * session (the one making the request); `session_id` ends just that one.
 */
export async function endSessions(
  trx: Transaction<DB>,
  input: { user_id: string; keep_token_hash?: string | null; session_id?: string },
): Promise<number> {
  let query = trx.updateTable('refresh_tokens').set({ revoked_at: sql`now()` })
    .where('user_id', '=', input.user_id).where('revoked_at', 'is', null);
  if (input.session_id) query = query.where('session_id', '=', input.session_id);
  if (input.keep_token_hash) query = query.where('token_hash', '<>', input.keep_token_hash);
  const ended = await query.returning('session_id').execute();
  for (const row of ended) revokeSession(row.session_id);

  // Ending every session also refuses anything issued up to now, whichever
  // session it names (a token from before sessions were named has none).
  if (!input.session_id && !input.keep_token_hash) {
    const moment = Math.floor(Date.now() / 1000) + 1;
    await trx.updateTable('users').set({ sessions_revoked_at: new Date(moment * 1000).toISOString() })
      .where('id', '=', input.user_id).execute();
    revokeAccessTokensBefore(input.user_id, moment);
  }
  return ended.length;
}

export async function changePassword(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: { current_password: string; new_password: string; keep_token_hash: string | null },
): Promise<void> {
  const user = await loadUser(trx, ctx);
  if (!(await verifyPassword(input.current_password, user.password_hash))) {
    // Not a 401: that would make the app try to refresh the session and sign the person out.
    throw new BusinessRuleError(ERR.PRECONDITION_FAILED, 'The current password is not right.');
  }
  if (input.new_password === input.current_password) {
    throw new BusinessRuleError(ERR.PRECONDITION_FAILED, 'The new password is the same as the current one.');
  }
  await trx.updateTable('users')
    .set({ password_hash: await hashPassword(input.new_password), failed_login_count: 0, locked_until: null })
    .where('id', '=', user.id).execute();
  // Every other browser is signed out; this one stays.
  await endSessions(trx, { user_id: user.id, keep_token_hash: input.keep_token_hash });
  await auditRecord(trx, ctx, {
    action: AUDIT.AUTH_PASSWORD_CHANGE, entity_type: 'user', entity_id: user.id, before: null, after: { email: user.email },
  });
}

export type SessionRow = {
  id: string;
  started_at: string;
  last_active_at: string;
  user_agent: string | null;
  ip_address: string | null;
  current: boolean;
};

/** The browsers this user is signed in on, newest first. */
export async function listSessions(
  db: Kysely<DB>, user_id: string, current_token_hash: string | null,
): Promise<SessionRow[]> {
  const rows = await db.selectFrom('refresh_tokens')
    .select(['session_id', 'token_hash', 'session_started_at', 'created_at', 'user_agent', 'ip_address'])
    .where('user_id', '=', user_id)
    .where('revoked_at', 'is', null)
    .where('expires_at', '>', sql<Date>`now()`)
    .orderBy('created_at', 'desc')
    .execute();
  return rows.map(row => ({
    id: row.session_id,
    started_at: new Date(row.session_started_at).toISOString(),
    // The token is replaced each time the session is renewed, so its own date is when it was last active.
    last_active_at: new Date(row.created_at as unknown as string).toISOString(),
    user_agent: row.user_agent,
    ip_address: row.ip_address,
    current: current_token_hash !== null && row.token_hash === current_token_hash,
  }));
}

export async function signOutSessions(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: { keep_token_hash?: string | null; session_id?: string },
): Promise<{ ended: number }> {
  const ended = await endSessions(trx, { user_id: ctx.user_id, ...input });
  await auditRecord(trx, ctx, {
    action: AUDIT.AUTH_SESSIONS_REVOKE, entity_type: 'user', entity_id: ctx.user_id, before: null,
    after: { ended, one_session: input.session_id ?? null, kept_current: Boolean(input.keep_token_hash) },
  });
  return { ended };
}

/** Whether the second step is on for this user. */
export async function accountStatus(db: Kysely<DB>, user_id: string) {
  const user = await db.selectFrom('users').select(['email', 'totp_enabled_at'])
    .where('id', '=', user_id).where('deleted_at', 'is', null).executeTakeFirst();
  if (!user) throw new NotFoundError('user', user_id);
  return { email: user.email, two_step_enabled: user.totp_enabled_at !== null };
}

/**
 * Starts setting up the second step: makes a secret and returns it for the
 * authenticator app. Nothing is asked for at sign-in until it is confirmed
 * with a code (confirmTwoStep), so an abandoned set-up locks nobody out.
 */
export async function beginTwoStep(trx: Transaction<DB>, ctx: ServiceCtx): Promise<{ secret: string; otpauth_uri: string }> {
  const user = await loadUser(trx, ctx);
  if (user.totp_enabled_at) {
    throw new BusinessRuleError(ERR.PRECONDITION_FAILED, 'The second step is already on. Turn it off first to set it up again.');
  }
  const secret = generateTotpSecret();
  await trx.updateTable('users').set({ totp_secret: encryptField(secret) }).where('id', '=', user.id).execute();
  return { secret, otpauth_uri: otpauthUri({ secret, account: user.email, issuer: ISSUER }) };
}

export async function confirmTwoStep(trx: Transaction<DB>, ctx: ServiceCtx, input: { code: string }): Promise<void> {
  const user = await loadUser(trx, ctx);
  if (user.totp_enabled_at) throw new BusinessRuleError(ERR.PRECONDITION_FAILED, 'The second step is already on.');
  if (!user.totp_secret) throw new BusinessRuleError(ERR.PRECONDITION_FAILED, 'Start the set-up first.');
  if (!verifyTotp(decryptField(user.totp_secret), input.code)) {
    throw new BusinessRuleError(ERR.PRECONDITION_FAILED, 'That code is not right. Check the app and try again.');
  }
  await trx.updateTable('users').set({ totp_enabled_at: sql`now()` }).where('id', '=', user.id).execute();
  await auditRecord(trx, ctx, {
    action: AUDIT.AUTH_TWO_STEP_ENABLE, entity_type: 'user', entity_id: user.id, before: null, after: { email: user.email },
  });
}

export async function turnOffTwoStep(trx: Transaction<DB>, ctx: ServiceCtx, input: { password: string }): Promise<void> {
  const user = await loadUser(trx, ctx);
  if (!(await verifyPassword(input.password, user.password_hash))) {
    throw new BusinessRuleError(ERR.PRECONDITION_FAILED, 'The password is not right.');
  }
  await trx.updateTable('users').set({ totp_secret: null, totp_enabled_at: null }).where('id', '=', user.id).execute();
  await auditRecord(trx, ctx, {
    action: AUDIT.AUTH_TWO_STEP_DISABLE, entity_type: 'user', entity_id: user.id, before: null, after: { email: user.email },
  });
}
