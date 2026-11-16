import type { Kysely, Transaction } from 'kysely';
import { AUDIT, ERR } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import { BusinessRuleError, NotFoundError } from '../../lib/errors.js';
import { config } from '../../config.js';
import { record as auditRecord } from '../audit/auditService.js';
import type { ServiceCtx } from '../../lib/ctx.js';
import { generateSetupToken, hashSetupToken } from '../auth/tokenService.js';
import { sendEmail, primaryAdminTransferEmail } from '../notifications/emailService.js';
import type { ReqMeta } from '../auth/authService.js';

// The firm's single top-level owner among its (possibly several) firm
// admins: the only one who can't be demoted or deactivated, and the only
// one who can transfer the designation onward. Spec:
// docs/specs/2026-11-15-user-invitations-and-signin-design.md
const TRANSFER_DAYS = 7;

export async function isPrimaryAdmin(trx: Transaction<DB> | Kysely<DB>, firm_id: string, user_id: string): Promise<boolean> {
  const firm = await trx.selectFrom('firms').select('primary_admin_user_id').where('id', '=', firm_id).executeTakeFirst();
  return firm?.primary_admin_user_id === user_id;
}

/** Starts transferring the designation. Only the current primary admin may call this. */
export async function initiateTransfer(trx: Transaction<DB>, ctx: ServiceCtx, input: { target_user_id: string }) {
  const firm = await trx.selectFrom('firms').selectAll().where('id', '=', ctx.firm_id).executeTakeFirstOrThrow();
  if (firm.primary_admin_user_id !== ctx.user_id) {
    throw new BusinessRuleError(ERR.FORBIDDEN, 'Only the Primary Admin can transfer the role.');
  }
  if (firm.transfer_target_user_id && firm.transfer_expires_at && new Date(firm.transfer_expires_at).getTime() > Date.now()) {
    throw new BusinessRuleError(ERR.PRECONDITION_FAILED, 'A transfer is already pending. Cancel it first.');
  }
  if (input.target_user_id === ctx.user_id) {
    throw new BusinessRuleError(ERR.VALIDATION_FAILED, 'You are already the Primary Admin.');
  }
  const target = await trx.selectFrom('users').select(['id', 'email', 'full_name', 'role', 'firm_id', 'deactivated_at'])
    .where('id', '=', input.target_user_id).where('deleted_at', 'is', null).executeTakeFirst();
  if (!target || target.firm_id !== ctx.firm_id) throw new NotFoundError('user', input.target_user_id);
  if (target.role !== 'firm_admin' || target.deactivated_at) {
    throw new BusinessRuleError(ERR.VALIDATION_FAILED, 'Choose a user who already has the Firm admin role.');
  }

  const raw = generateSetupToken();
  const token_hash = await hashSetupToken(raw);
  const expires_at = new Date(Date.now() + TRANSFER_DAYS * 24 * 3600_000);
  await trx.updateTable('firms').set({
    transfer_target_user_id: target.id,
    transfer_token_hash: token_hash,
    transfer_expires_at: expires_at.toISOString() as unknown as string,
  }).where('id', '=', ctx.firm_id).execute();

  const admin = await trx.selectFrom('users').select('full_name').where('id', '=', ctx.user_id).executeTakeFirst();
  const acceptUrl = `${config.APP_PUBLIC_URL}/accept-primary-admin?token=${raw}`;
  const email_sent = await sendEmail(primaryAdminTransferEmail({
    to: target.email, firmName: firm.name, currentAdminName: admin?.full_name ?? 'The current Primary Admin', acceptUrl,
  }));

  await auditRecord(trx, ctx, {
    action: AUDIT.PRIMARY_ADMIN_TRANSFER_INITIATE, entity_type: 'firm', entity_id: ctx.firm_id,
    before: null, after: { target_user_id: target.id, target_email: target.email },
  });
  return { ok: true, target_email: target.email, email_sent };
}

/** The current primary admin cancels a transfer they started, before it's accepted. */
export async function cancelTransfer(trx: Transaction<DB>, ctx: ServiceCtx) {
  const firm = await trx.selectFrom('firms').selectAll().where('id', '=', ctx.firm_id).executeTakeFirstOrThrow();
  if (firm.primary_admin_user_id !== ctx.user_id) {
    throw new BusinessRuleError(ERR.FORBIDDEN, 'Only the Primary Admin can cancel a transfer.');
  }
  if (!firm.transfer_target_user_id) return { ok: true };
  await trx.updateTable('firms').set({ transfer_target_user_id: null, transfer_token_hash: null, transfer_expires_at: null })
    .where('id', '=', ctx.firm_id).execute();
  await auditRecord(trx, ctx, {
    action: AUDIT.PRIMARY_ADMIN_TRANSFER_CANCEL, entity_type: 'firm', entity_id: ctx.firm_id,
    before: { target_user_id: firm.transfer_target_user_id }, after: null,
  });
  return { ok: true };
}

export type TransferStatus = { pending: false } | { pending: true; target_user_id: string; target_name: string; target_email: string };

/** Whether this firm has a transfer in flight — for the "Transfer pending" badge. */
export async function getTransferStatus(db: Kysely<DB>, firm_id: string): Promise<TransferStatus> {
  const firm = await db.selectFrom('firms as f')
    .leftJoin('users as target', 'target.id', 'f.transfer_target_user_id')
    .select(['f.transfer_target_user_id', 'f.transfer_expires_at', 'target.full_name as target_name', 'target.email as target_email'])
    .where('f.id', '=', firm_id).executeTakeFirst();
  if (!firm?.transfer_target_user_id || !firm.transfer_expires_at || new Date(firm.transfer_expires_at).getTime() < Date.now()) {
    return { pending: false };
  }
  return { pending: true, target_user_id: firm.transfer_target_user_id, target_name: firm.target_name ?? '', target_email: firm.target_email ?? '' };
}

type TransferLookup = { firm_id: string; firm_name: string; target_user_id: string; target_email: string; current_admin_name: string };

const INVALID_TRANSFER = 'This invitation has expired or is no longer valid. Ask the Primary Admin to send a new one.';

/** The person and firm a transfer link is for, or refused if it's used up. */
export async function validateTransferToken(db: Kysely<DB>, token: string): Promise<TransferLookup> {
  const token_hash = await hashSetupToken(token);
  const row = await db.selectFrom('firms as f')
    .innerJoin('users as target', 'target.id', 'f.transfer_target_user_id')
    .leftJoin('users as current_admin', 'current_admin.id', 'f.primary_admin_user_id')
    .select([
      'f.id as firm_id', 'f.name as firm_name', 'f.transfer_expires_at',
      'target.id as target_user_id', 'target.email as target_email',
      'current_admin.full_name as current_admin_name',
    ])
    .where('f.transfer_token_hash', '=', token_hash)
    .executeTakeFirst();
  if (!row || !row.transfer_expires_at || new Date(row.transfer_expires_at).getTime() < Date.now()) {
    throw new BusinessRuleError(ERR.PRECONDITION_FAILED, INVALID_TRANSFER);
  }
  return {
    firm_id: row.firm_id, firm_name: row.firm_name, target_user_id: row.target_user_id,
    target_email: row.target_email, current_admin_name: row.current_admin_name ?? 'The current Primary Admin',
  };
}

/** The target accepts: they become Primary Admin, the old one keeps firm_admin and all their access. */
export async function acceptTransfer(db: Kysely<DB>, input: { token: string }, meta: ReqMeta): Promise<void> {
  const lookup = await validateTransferToken(db, input.token);
  const token_hash = await hashSetupToken(input.token);

  await db.transaction().execute(async (trx) => {
    const before = await trx.selectFrom('firms').select('primary_admin_user_id').where('id', '=', lookup.firm_id).executeTakeFirstOrThrow();
    // Same condition repeated in the WHERE as validateTransferToken checked,
    // so two requests racing on the same link can't both succeed.
    const updated = await trx.updateTable('firms')
      .set({ primary_admin_user_id: lookup.target_user_id, transfer_target_user_id: null, transfer_token_hash: null, transfer_expires_at: null })
      .where('id', '=', lookup.firm_id).where('transfer_token_hash', '=', token_hash)
      .returning('id').executeTakeFirst();
    if (!updated) throw new BusinessRuleError(ERR.PRECONDITION_FAILED, INVALID_TRANSFER);

    await auditRecord(trx, {
      user_id: lookup.target_user_id, firm_id: lookup.firm_id, business_id: null, effective_role: 'firm_admin', ...meta,
    }, {
      action: AUDIT.PRIMARY_ADMIN_TRANSFER_ACCEPT, entity_type: 'firm', entity_id: lookup.firm_id,
      before: { primary_admin_user_id: before.primary_admin_user_id }, after: { primary_admin_user_id: lookup.target_user_id },
    });
  });
}

/** The target declines: nothing changes except the link stops working. */
export async function declineTransfer(db: Kysely<DB>, input: { token: string }, meta: ReqMeta): Promise<void> {
  const lookup = await validateTransferToken(db, input.token);
  const token_hash = await hashSetupToken(input.token);

  await db.transaction().execute(async (trx) => {
    const updated = await trx.updateTable('firms')
      .set({ transfer_target_user_id: null, transfer_token_hash: null, transfer_expires_at: null })
      .where('id', '=', lookup.firm_id).where('transfer_token_hash', '=', token_hash)
      .returning('id').executeTakeFirst();
    if (!updated) throw new BusinessRuleError(ERR.PRECONDITION_FAILED, INVALID_TRANSFER);

    await auditRecord(trx, {
      user_id: lookup.target_user_id, firm_id: lookup.firm_id, business_id: null, effective_role: 'firm_admin', ...meta,
    }, {
      action: AUDIT.PRIMARY_ADMIN_TRANSFER_DECLINE, entity_type: 'firm', entity_id: lookup.firm_id, before: null, after: null,
    });
  });
}
