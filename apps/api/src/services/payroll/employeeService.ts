import { sql, type Kysely, type Transaction } from 'kysely';
import { AUDIT } from '@accounting/shared';
import type { DB, PayFrequency, W4FilingStatus } from '../../db/types.js';
import { NotFoundError } from '../../lib/errors.js';
import { record as auditRecord } from '../audit/auditService.js';
import { encryptField, decryptField, lastFour } from '../../lib/fieldCrypto.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type CreateEmployeeInput = {
  business_id: string;
  full_name: string;
  email?: string | null;
  phone?: string | null;
  address?: unknown;
  ssn?: string | null;
  hire_date: string;
  termination_date?: string | null;
  default_pay_rate_cents?: number;
  default_pay_frequency?: PayFrequency;
  w4_filing_status?: W4FilingStatus | null;
};

export async function createEmployee(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: CreateEmployeeInput,
) {
  let ssn_encrypted: Buffer | null = null;
  let ssn_last_four: string | null = null;
  if (input.ssn) {
    ssn_encrypted = encryptField(input.ssn);
    ssn_last_four = lastFour(input.ssn);
  }

  const values: {
    business_id: string;
    full_name: string;
    email: string | null;
    phone: string | null;
    address: unknown | null;
    ssn_encrypted: Buffer | null;
    ssn_last_four: string | null;
    hire_date: string;
    termination_date?: string | null;
    default_pay_rate_cents?: string;
    default_pay_frequency?: PayFrequency;
    w4_filing_status?: W4FilingStatus | null;
  } = {
    business_id: input.business_id,
    full_name: input.full_name,
    email: input.email ?? null,
    phone: input.phone ?? null,
    address: input.address === undefined ? null : (input.address ?? null),
    ssn_encrypted,
    ssn_last_four,
    hire_date: input.hire_date,
  };
  if (input.termination_date !== undefined) values.termination_date = input.termination_date;
  if (input.default_pay_rate_cents !== undefined) {
    values.default_pay_rate_cents = String(input.default_pay_rate_cents);
  }
  if (input.default_pay_frequency !== undefined) {
    values.default_pay_frequency = input.default_pay_frequency;
  }
  if (input.w4_filing_status !== undefined) {
    values.w4_filing_status = input.w4_filing_status;
  }

  const row = await trx.insertInto('employees').values(values).returningAll().executeTakeFirstOrThrow();
  await auditRecord(trx, ctx, {
    action: AUDIT.EMPLOYEE_CREATE,
    entity_type: 'employee',
    entity_id: row.id,
    before: null,
    after: { ...row, ssn_encrypted: row.ssn_encrypted ? '<encrypted>' : null },
  });
  return row;
}

export async function updateEmployee(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: { employee_id: string; patch: Partial<CreateEmployeeInput> & { is_active?: boolean } },
) {
  const before = await trx.selectFrom('employees').selectAll()
    .where('id', '=', input.employee_id).executeTakeFirst();
  if (!before || before.deleted_at) throw new NotFoundError('employee', input.employee_id);

  let ssnPatch: Partial<{
    ssn_encrypted: Buffer | null;
    ssn_last_four: string | null;
  }> = {};
  if (input.patch.ssn !== undefined) {
    if (input.patch.ssn === null) {
      ssnPatch = { ssn_encrypted: null, ssn_last_four: null };
    } else {
      ssnPatch = {
        ssn_encrypted: encryptField(input.patch.ssn),
        ssn_last_four: lastFour(input.patch.ssn),
      };
    }
  }

  const updated = await trx.updateTable('employees').set({
    ...(input.patch.full_name !== undefined ? { full_name: input.patch.full_name } : {}),
    ...(input.patch.email !== undefined ? { email: input.patch.email ?? null } : {}),
    ...(input.patch.phone !== undefined ? { phone: input.patch.phone ?? null } : {}),
    ...(input.patch.address !== undefined ? { address: input.patch.address ?? null } : {}),
    ...(input.patch.termination_date !== undefined ? { termination_date: input.patch.termination_date } : {}),
    ...(input.patch.default_pay_rate_cents !== undefined ? { default_pay_rate_cents: String(input.patch.default_pay_rate_cents) } : {}),
    ...(input.patch.default_pay_frequency !== undefined ? { default_pay_frequency: input.patch.default_pay_frequency } : {}),
    ...(input.patch.w4_filing_status !== undefined ? { w4_filing_status: input.patch.w4_filing_status } : {}),
    ...(input.patch.is_active !== undefined ? { is_active: input.patch.is_active } : {}),
    ...ssnPatch,
  }).where('id', '=', input.employee_id).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.EMPLOYEE_UPDATE,
    entity_type: 'employee',
    entity_id: input.employee_id,
    before: { ...before, ssn_encrypted: before.ssn_encrypted ? '<encrypted>' : null },
    after: { ...updated, ssn_encrypted: updated.ssn_encrypted ? '<encrypted>' : null },
  });
  return updated;
}

export async function deleteEmployee(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: { employee_id: string },
) {
  const before = await trx.selectFrom('employees').selectAll()
    .where('id', '=', input.employee_id).executeTakeFirst();
  if (!before || before.deleted_at) throw new NotFoundError('employee', input.employee_id);

  await trx.updateTable('employees')
    .set({ deleted_at: sql`now()`, is_active: false })
    .where('id', '=', input.employee_id)
    .execute();
  await auditRecord(trx, ctx, {
    action: AUDIT.EMPLOYEE_DELETE,
    entity_type: 'employee',
    entity_id: input.employee_id,
    before: { ...before, ssn_encrypted: before.ssn_encrypted ? '<encrypted>' : null },
    after: null,
  });
}

export async function revealSSN(
  db: Kysely<DB>,
  ctx: ServiceCtx,
  employee_id: string,
): Promise<string | null> {
  const e = await db.selectFrom('employees').selectAll()
    .where('id', '=', employee_id)
    .where('business_id', '=', ctx.business_id ?? '')
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!e) throw new NotFoundError('employee', employee_id);
  await db.transaction().execute(async trx => {
    await auditRecord(trx, ctx, {
      action: AUDIT.EMPLOYEE_SSN_REVEAL,
      entity_type: 'employee',
      entity_id: e.id,
      before: null,
      after: { revealed_by: ctx.user_id, last_four: e.ssn_last_four },
    });
  });
  return e.ssn_encrypted ? decryptField(Buffer.from(e.ssn_encrypted)) : null;
}

export async function listEmployees(db: Kysely<DB>, business_id: string) {
  return db.selectFrom('employees').selectAll()
    .where('business_id', '=', business_id)
    .where('deleted_at', 'is', null)
    .orderBy('full_name')
    .execute();
}

export async function getEmployee(db: Kysely<DB>, business_id: string, id: string) {
  const e = await db.selectFrom('employees').selectAll()
    .where('id', '=', id)
    .where('business_id', '=', business_id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!e) throw new NotFoundError('employee', id);
  return e;
}
