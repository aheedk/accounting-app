import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import { AUDIT, schemas } from '@accounting/shared';
import type { CustomReportDefinitionsTable, DB } from '../../db/types.js';
import { NotFoundError } from '../../lib/errors.js';
import { record as auditRecord } from '../audit/auditService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type CustomReport = Selectable<CustomReportDefinitionsTable>;

// Re-export the definition shape from the shared schemas namespace so callers
// in apps/api can refer to a single canonical type.
export type CustomReportDefinition = schemas.CustomReportDefinition;

export type CreateCustomReportInput = {
  business_id: string;
  name: string;
  definition: CustomReportDefinition;
};

export type UpdateCustomReportInput = {
  report_id: string;
  patch: {
    name?: string;
    definition?: CustomReportDefinition;
  };
};

export type DeleteCustomReportInput = {
  report_id: string;
};

export async function createReport(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: CreateCustomReportInput,
): Promise<CustomReport> {
  const row = await trx.insertInto('custom_report_definitions').values({
    business_id: input.business_id,
    name: input.name,
    owner_user_id: ctx.user_id,
    definition: input.definition as object,
  }).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.CUSTOM_REPORT_CREATE,
    entity_type: 'custom_report',
    entity_id: row.id,
    before: null,
    after: row,
  });
  return row;
}

export async function updateReport(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: UpdateCustomReportInput,
): Promise<CustomReport> {
  const before = await trx.selectFrom('custom_report_definitions').selectAll()
    .where('id', '=', input.report_id)
    .executeTakeFirst();
  if (!before) throw new NotFoundError('custom_report', input.report_id);

  const updateSet: { name?: string; definition?: object } = {};
  if (input.patch.name !== undefined) updateSet.name = input.patch.name;
  if (input.patch.definition !== undefined) updateSet.definition = input.patch.definition as object;

  const updated = await trx.updateTable('custom_report_definitions')
    .set(updateSet)
    .where('id', '=', input.report_id)
    .returningAll()
    .executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.CUSTOM_REPORT_UPDATE,
    entity_type: 'custom_report',
    entity_id: input.report_id,
    before,
    after: updated,
  });
  return updated;
}

export async function deleteReport(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: DeleteCustomReportInput,
): Promise<void> {
  const before = await trx.selectFrom('custom_report_definitions').selectAll()
    .where('id', '=', input.report_id)
    .executeTakeFirst();
  if (!before) throw new NotFoundError('custom_report', input.report_id);

  await trx.deleteFrom('custom_report_definitions')
    .where('id', '=', input.report_id)
    .execute();

  await auditRecord(trx, ctx, {
    action: AUDIT.CUSTOM_REPORT_DELETE,
    entity_type: 'custom_report',
    entity_id: input.report_id,
    before,
    after: null,
  });
}

export async function listReports(
  db: Kysely<DB>,
  business_id: string,
): Promise<CustomReport[]> {
  return db.selectFrom('custom_report_definitions')
    .selectAll()
    .where('business_id', '=', business_id)
    .orderBy('name')
    .execute();
}

export async function getReport(
  db: Kysely<DB>,
  business_id: string,
  id: string,
): Promise<CustomReport> {
  const row = await db.selectFrom('custom_report_definitions')
    .selectAll()
    .where('id', '=', id)
    .where('business_id', '=', business_id)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('custom_report', id);
  return row;
}

export type CustomReportRow = {
  group_key: string;
  debit: string;
  credit: string;
  net: string;
};

export async function runReport(
  db: Kysely<DB>,
  business_id: string,
  def: CustomReportDefinition,
): Promise<CustomReportRow[]> {
  // For slice 12, group_by values 'cost_center' / 'customer' / 'vendor' are
  // not first-class on journal_entry_lines yet, so they fall back to grouping
  // by account (code + name). Only 'month' uses date_trunc.
  const groupExpr = def.group_by === 'month'
    ? sql`to_char(je.entry_date, 'YYYY-MM')`
    : sql`coa.code || ' ' || coa.name`;

  const accountFilter = def.account_ids.length > 0
    ? sql`AND jel.account_id = ANY(${def.account_ids}::uuid[])`
    : sql``;

  const result = await db.executeQuery<CustomReportRow>(
    sql<CustomReportRow>`
      SELECT
        ${groupExpr}::text AS group_key,
        COALESCE(SUM(jel.debit), 0)::text AS debit,
        COALESCE(SUM(jel.credit), 0)::text AS credit,
        (COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0))::text AS net
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.journal_entry_id
      JOIN chart_of_accounts coa ON coa.id = jel.account_id
      WHERE je.business_id = ${business_id}
        AND je.status = 'posted'
        AND je.entry_date >= ${def.date_range.from}
        AND je.entry_date <= ${def.date_range.to}
        ${accountFilter}
      GROUP BY ${groupExpr}
      ORDER BY group_key
    `.compile(db),
  );
  return result.rows;
}
