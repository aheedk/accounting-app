import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { AUDIT, ERR } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import { BusinessRuleError } from '../../lib/errors.js';
import { config } from '../../config.js';
import { record as auditRecord } from '../audit/auditService.js';
import { generateSetupToken, hashSetupToken } from './tokenService.js';
import { sendEmail, passwordResetEmail } from '../notifications/emailService.js';
import { endSessions } from './accountService.js';
import { hashPassword } from './passwordHasher.js';
import type { ReqMeta } from './authService.js';

// Self-service "forgot password", a public, unauthenticated link — separate
// from a firm admin's "Reset password" (userManagementService.resetUserPassword).
// Spec: docs/specs/2026-11-15-user-invitations-and-signin-design.md
const RESET_HOURS = 1;

/**
 * Emails a reset link if the address has an active login; does nothing,
 * silently, otherwise. The route always answers the same way either way, so
 * this never reveals which emails have logins — same reasoning as login()'s
 * unknownEmailHash.
 */
export async function requestPasswordReset(db: Kysely<DB>, input: { email: string }, meta: ReqMeta): Promise<void> {
  const user = await db.selectFrom('users')
    .select(['id', 'firm_id', 'email'])
    .where('email', '=', input.email).where('deleted_at', 'is', null).where('deactivated_at', 'is', null)
    .executeTakeFirst();
  if (!user) return;

  const raw = generateSetupToken();
  const token_hash = await hashSetupToken(raw);
  const expires_at = new Date(Date.now() + RESET_HOURS * 3600_000);
  await db.transaction().execute(async (trx) => {
    await trx.updateTable('users').set({
      password_reset_token_hash: token_hash,
      password_reset_expires_at: expires_at.toISOString() as unknown as string,
    }).where('id', '=', user.id).execute();
    await auditRecord(trx, {
      user_id: user.id, firm_id: user.firm_id, business_id: null, effective_role: 'staff', ...meta,
    }, {
      action: AUDIT.AUTH_PASSWORD_RESET_REQUEST, entity_type: 'user', entity_id: user.id, before: null, after: null,
    });
  });

  const resetUrl = `${config.APP_PUBLIC_URL}/reset-password?token=${raw}`;
  await sendEmail(passwordResetEmail({ to: user.email, resetUrl }));
}

const INVALID_RESET = 'This password reset link has expired or is no longer valid. Request a new one.';

/** The email a reset link is for, or refused if it's used up. */
export async function validatePasswordResetToken(db: Kysely<DB>, token: string): Promise<{ email: string }> {
  const token_hash = await hashSetupToken(token);
  const row = await db.selectFrom('users')
    .select(['email', 'password_reset_expires_at'])
    .where('password_reset_token_hash', '=', token_hash)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!row || !row.password_reset_expires_at || new Date(row.password_reset_expires_at).getTime() < Date.now()) {
    throw new BusinessRuleError(ERR.PRECONDITION_FAILED, INVALID_RESET);
  }
  return { email: row.email };
}

/** Sets a new password from a reset link and ends every session on the login. */
export async function completePasswordReset(db: Kysely<DB>, input: { token: string; password: string }, meta: ReqMeta): Promise<void> {
  const token_hash = await hashSetupToken(input.token);
  const row = await db.selectFrom('users')
    .select(['id', 'firm_id', 'email', 'password_reset_expires_at'])
    .where('password_reset_token_hash', '=', token_hash)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!row || !row.password_reset_expires_at || new Date(row.password_reset_expires_at).getTime() < Date.now()) {
    throw new BusinessRuleError(ERR.PRECONDITION_FAILED, INVALID_RESET);
  }

  const password_hash = await hashPassword(input.password);
  await db.transaction().execute(async (trx) => {
    // The check (above) and the write are two round trips, so the same
    // condition (this exact token, still unused) is repeated here: two
    // requests racing on the same link must not both succeed.
    const updated = await trx.updateTable('users').set({
      password_hash,
      password_reset_token_hash: null,
      password_reset_expires_at: null,
      email_verified: true,
      must_change_password: false,
      failed_login_count: 0,
      locked_until: null,
      updated_at: sql`now()`,
    })
      .where('id', '=', row.id)
      .where('password_reset_token_hash', '=', token_hash)
      .returning('id')
      .executeTakeFirst();
    if (!updated) throw new BusinessRuleError(ERR.PRECONDITION_FAILED, INVALID_RESET);
    await endSessions(trx, { user_id: row.id });
    await auditRecord(trx, {
      user_id: row.id, firm_id: row.firm_id, business_id: null, effective_role: 'staff', ...meta,
    }, {
      action: AUDIT.AUTH_PASSWORD_RESET_COMPLETE, entity_type: 'user', entity_id: row.id, before: null, after: { email: row.email },
    });
  });
}
