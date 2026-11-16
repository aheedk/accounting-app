import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';
import { AUDIT, ERR } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import { BusinessRuleError, NotFoundError } from '../../lib/errors.js';
import { config } from '../../config.js';
import { record as auditRecord } from '../audit/auditService.js';
import type { ServiceCtx } from '../../lib/ctx.js';
import { generateSetupToken, hashSetupToken } from './tokenService.js';
import { sendEmail, invitationEmail } from '../notifications/emailService.js';
import { login, type ReqMeta, type LoginResult } from './authService.js';
import { hashPassword } from './passwordHasher.js';

// An invitation link in place of an admin-typed password. Spec:
// docs/specs/2026-11-15-user-invitations-and-signin-design.md
const INVITATION_DAYS = 30;

/**
 * Writes a fresh invitation token onto an already-created user row and
 * emails it. Called from inside the transaction that creates (or resends
 * for) the login: the email-send itself is swallowed on failure
 * (emailService), so doing it here rather than after commit costs nothing
 * and keeps "create the login" one step instead of two.
 */
export async function issueInvitation(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  user: { id: string; email: string },
  firmName: string,
  adminName: string,
): Promise<boolean> {
  const raw = generateSetupToken();
  const token_hash = await hashSetupToken(raw);
  const expires_at = new Date(Date.now() + INVITATION_DAYS * 24 * 3600_000);
  await trx.updateTable('users').set({
    invitation_token_hash: token_hash,
    invitation_expires_at: expires_at.toISOString() as unknown as string,
    invitation_status: 'sent',
  }).where('id', '=', user.id).execute();

  const acceptUrl = `${config.APP_PUBLIC_URL}/accept-invitation?token=${raw}`;
  const email_sent = await sendEmail(invitationEmail({ to: user.email, firmName, adminName, acceptUrl }));

  await auditRecord(trx, ctx, {
    action: AUDIT.USER_INVITE_SEND, entity_type: 'user', entity_id: user.id, before: null, after: { email: user.email, email_sent },
  });
  return email_sent;
}

/** Admin action: a fresh link and expiry, re-sent. Refused once accepted. */
export async function resendInvitation(trx: Transaction<DB>, ctx: ServiceCtx, input: { user_id: string }) {
  const user = await trx.selectFrom('users')
    .select(['id', 'email', 'full_name', 'firm_id', 'invitation_status'])
    .where('id', '=', input.user_id).where('firm_id', '=', ctx.firm_id).where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!user) throw new NotFoundError('user', input.user_id);
  if (user.invitation_status === 'accepted') {
    throw new BusinessRuleError(ERR.PRECONDITION_FAILED, `${user.full_name} has already set up their account.`);
  }
  // Sequential, not Promise.all — see the matching comment in
  // userManagementService.createUser.
  const firm = await trx.selectFrom('firms').select('name').where('id', '=', ctx.firm_id).executeTakeFirstOrThrow();
  const admin = await trx.selectFrom('users').select('full_name').where('id', '=', ctx.user_id).executeTakeFirst();
  const email_sent = await issueInvitation(trx, ctx, user, firm.name, admin?.full_name ?? 'Your firm admin');
  await auditRecord(trx, ctx, {
    action: AUDIT.USER_INVITE_RESEND, entity_type: 'user', entity_id: user.id, before: null, after: { email: user.email, email_sent },
  });
  return { ok: true, email_sent };
}

type InvitationLookup = { user_id: string; firm_id: string; email: string; full_name: string; firm_name: string };

const INVALID_INVITATION = "This invitation has expired or is no longer valid. Contact your administrator for a new one.";

/** The person and firm an invitation link is for, or refused if it's used up. */
export async function validateInvitationToken(db: Kysely<DB>, token: string): Promise<InvitationLookup> {
  const token_hash = await hashSetupToken(token);
  const row = await db.selectFrom('users')
    .innerJoin('firms', 'firms.id', 'users.firm_id')
    .select(['users.id as user_id', 'users.firm_id', 'users.email', 'users.full_name', 'users.invitation_status', 'users.invitation_expires_at', 'firms.name as firm_name'])
    .where('invitation_token_hash', '=', token_hash)
    .where('users.deleted_at', 'is', null)
    .executeTakeFirst();
  if (!row || row.invitation_status === 'accepted' || !row.invitation_expires_at
    || new Date(row.invitation_expires_at).getTime() < Date.now()) {
    throw new BusinessRuleError(ERR.PRECONDITION_FAILED, INVALID_INVITATION);
  }
  return { user_id: row.user_id, firm_id: row.firm_id, email: row.email, full_name: row.full_name, firm_name: row.firm_name };
}

/** Sets the person's own password, activates the login, and signs them in. */
export async function acceptInvitation(
  db: Kysely<DB>,
  input: { token: string; password: string; full_name?: string | undefined },
  meta: ReqMeta,
): Promise<LoginResult> {
  const lookup = await validateInvitationToken(db, input.token);
  const token_hash = await hashSetupToken(input.token);

  await db.transaction().execute(async (trx) => {
    const password_hash = await hashPassword(input.password);
    // The check (validateInvitationToken, above) and the write are two
    // separate round trips, so the same conditions are repeated in this
    // WHERE clause: two requests racing on the same link must not both
    // succeed (the TOTP code check in authService.login makes the same kind
    // of check-and-act atomic, for the same reason).
    const updated = await trx.updateTable('users').set({
      password_hash,
      invitation_status: 'accepted',
      invitation_token_hash: null,
      invitation_expires_at: null,
      email_verified: true,
      must_change_password: false,
      ...(input.full_name ? { full_name: input.full_name } : {}),
      updated_at: sql`now()`,
    })
      .where('id', '=', lookup.user_id)
      .where('invitation_token_hash', '=', token_hash)
      .where('invitation_status', '<>', 'accepted')
      .returning('id')
      .executeTakeFirst();
    if (!updated) throw new BusinessRuleError(ERR.PRECONDITION_FAILED, INVALID_INVITATION);

    await auditRecord(trx, {
      user_id: lookup.user_id, firm_id: lookup.firm_id, business_id: null, effective_role: 'staff',
      request_id: meta.request_id, ip_address: meta.ip_address, user_agent: meta.user_agent,
    }, {
      action: AUDIT.USER_INVITE_ACCEPT, entity_type: 'user', entity_id: lookup.user_id, before: null, after: { email: lookup.email },
    });
  });

  // The normal sign-in path: issues the session, records AUTH_LOGIN, and
  // returns the same shape any other sign-in does.
  return login(db, { email: lookup.email, password: input.password }, meta);
}
