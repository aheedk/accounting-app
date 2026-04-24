import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import { AUDIT, subMoney, toMoneyString } from '@accounting/shared';
import type {
  BudgetLinesTable,
  BudgetsTable,
  BudgetStatus,
  DB,
} from '../../db/types.js';
import { NotFoundError } from '../../lib/errors.js';
import { record as auditRecord } from '../audit/auditService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type Budget = Selectable<BudgetsTable>;
export type BudgetLine = Selectable<BudgetLinesTable>;

export type CreateBudgetInput = {
  business_id: string;
  name: string;
  fiscal_year: number;
};

export type UpdateBudgetInput = {
  budget_id: string;
  patch: {
    name?: string;
    status?: BudgetStatus;
  };
};

export type DeleteBudgetInput = {
  budget_id: string;
};

export type SetBudgetLineInput = {
  budget_id: string;
  account_id: string;
  month_offset: number;
  amount: string;
};

export type VarianceRow = {
  account_id: string;
  account_code: string;
  account_name: string;
  month_offset: number;
  budget: string;
  actual: string;
  variance: string;
};

export async function createBudget(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: CreateBudgetInput,
): Promise<Budget> {
  const row = await trx.insertInto('budgets').values({
    business_id: input.business_id,
    name: input.name,
    fiscal_year: input.fiscal_year,
    created_by_user_id: ctx.user_id === '00000000-0000-0000-0000-000000000000' ? null : ctx.user_id,
  }).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.BUDGET_CREATE,
    entity_type: 'budget',
    entity_id: row.id,
    before: null,
    after: row,
  });
  return row;
}

export async function updateBudget(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: UpdateBudgetInput,
): Promise<Budget> {
  const before = await trx.selectFrom('budgets').selectAll()
    .where('id', '=', input.budget_id)
    .executeTakeFirst();
  if (!before) throw new NotFoundError('budget', input.budget_id);

  const updateSet: { name?: string; status?: BudgetStatus } = {};
  if (input.patch.name !== undefined) updateSet.name = input.patch.name;
  if (input.patch.status !== undefined) updateSet.status = input.patch.status;

  const updated = await trx.updateTable('budgets')
    .set(updateSet)
    .where('id', '=', input.budget_id)
    .returningAll()
    .executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.BUDGET_UPDATE,
    entity_type: 'budget',
    entity_id: input.budget_id,
    before,
    after: updated,
  });
  return updated;
}

export async function deleteBudget(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: DeleteBudgetInput,
): Promise<void> {
  const before = await trx.selectFrom('budgets').selectAll()
    .where('id', '=', input.budget_id)
    .executeTakeFirst();
  if (!before) throw new NotFoundError('budget', input.budget_id);

  // budget_lines has ON DELETE CASCADE → child rows removed automatically.
  await trx.deleteFrom('budgets').where('id', '=', input.budget_id).execute();

  await auditRecord(trx, ctx, {
    action: AUDIT.BUDGET_DELETE,
    entity_type: 'budget',
    entity_id: input.budget_id,
    before,
    after: null,
  });
}

export async function setBudgetLine(
  trx: Transaction<DB>,
  _ctx: ServiceCtx,
  input: SetBudgetLineInput,
): Promise<BudgetLine> {
  // Verify the parent budget exists so we don't silently insert orphaned lines
  // when an arbitrary uuid is passed.
  const budget = await trx.selectFrom('budgets').select('id')
    .where('id', '=', input.budget_id)
    .executeTakeFirst();
  if (!budget) throw new NotFoundError('budget', input.budget_id);

  await trx.insertInto('budget_lines')
    .values({
      budget_id: input.budget_id,
      account_id: input.account_id,
      month_offset: input.month_offset,
      amount: input.amount,
    })
    .onConflict(oc => oc
      .columns(['budget_id', 'account_id', 'month_offset'])
      .doUpdateSet({ amount: input.amount }),
    )
    .execute();

  const row = await trx.selectFrom('budget_lines').selectAll()
    .where('budget_id', '=', input.budget_id)
    .where('account_id', '=', input.account_id)
    .where('month_offset', '=', input.month_offset)
    .executeTakeFirstOrThrow();
  return row;
}

export async function listBudgets(db: Kysely<DB>, business_id: string): Promise<Budget[]> {
  return db.selectFrom('budgets').selectAll()
    .where('business_id', '=', business_id)
    .orderBy('fiscal_year', 'desc')
    .orderBy('name', 'asc')
    .execute();
}

export async function getBudgetWithLines(
  db: Kysely<DB>,
  business_id: string,
  id: string,
): Promise<Budget & { lines: BudgetLine[] }> {
  const budget = await db.selectFrom('budgets').selectAll()
    .where('id', '=', id)
    .where('business_id', '=', business_id)
    .executeTakeFirst();
  if (!budget) throw new NotFoundError('budget', id);

  const lines = await db.selectFrom('budget_lines').selectAll()
    .where('budget_id', '=', id)
    .orderBy('account_id')
    .orderBy('month_offset')
    .execute();

  return { ...budget, lines };
}

type VarianceQueryRow = {
  account_id: string;
  account_code: string;
  account_name: string;
  month_offset: number;
  budget: string;
  actual: string;
};

export async function getVarianceReport(
  db: Kysely<DB>,
  business_id: string,
  budget_id: string,
): Promise<VarianceRow[]> {
  const budget = await db.selectFrom('budgets')
    .select(['id', 'business_id', 'fiscal_year'])
    .where('id', '=', budget_id)
    .where('business_id', '=', business_id)
    .executeTakeFirst();
  if (!budget) throw new NotFoundError('budget', budget_id);

  const yearStart = `${budget.fiscal_year}-01-01`;
  const yearEnd = `${budget.fiscal_year}-12-31`;

  // Build the sparse cross product of (account, month_offset) cells where
  // either the budget has a line OR there is JE activity in the budget's
  // fiscal year, then LEFT JOIN both sides for amounts.
  // For accounts: revenue is credit-normal (credit - debit), everything else
  // is debit-normal (debit - credit). We classify per row using account_type.
  const res = await db.executeQuery<VarianceQueryRow>(sql<VarianceQueryRow>`
    WITH actuals AS (
      SELECT
        coa.id   AS account_id,
        coa.code AS account_code,
        coa.name AS account_name,
        coa.account_type AS account_type,
        (EXTRACT(MONTH FROM je.entry_date)::int - 1) AS month_offset,
        SUM(
          CASE WHEN coa.account_type = 'revenue'
               THEN jel.credit - jel.debit
               ELSE jel.debit  - jel.credit
          END
        ) AS amount
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.journal_entry_id
      JOIN chart_of_accounts coa ON coa.id = jel.account_id
      WHERE je.business_id = ${business_id}::uuid
        AND je.status = 'posted'
        AND je.reversed_entry_id IS NULL
        AND je.entry_date >= ${yearStart}::date
        AND je.entry_date <= ${yearEnd}::date
      GROUP BY coa.id, coa.code, coa.name, coa.account_type, month_offset
    ),
    budget_cells AS (
      SELECT
        bl.account_id,
        coa.code AS account_code,
        coa.name AS account_name,
        bl.month_offset,
        bl.amount AS budget_amount
      FROM budget_lines bl
      JOIN chart_of_accounts coa ON coa.id = bl.account_id
      WHERE bl.budget_id = ${budget_id}::uuid
    ),
    cells AS (
      SELECT account_id, account_code, account_name, month_offset FROM budget_cells
      UNION
      SELECT account_id, account_code, account_name, month_offset FROM actuals
    )
    SELECT
      c.account_id   AS account_id,
      c.account_code AS account_code,
      c.account_name AS account_name,
      c.month_offset AS month_offset,
      COALESCE(b.budget_amount, 0)::text AS budget,
      COALESCE(a.amount,        0)::text AS actual
    FROM cells c
    LEFT JOIN budget_cells b
      ON b.account_id = c.account_id AND b.month_offset = c.month_offset
    LEFT JOIN actuals a
      ON a.account_id = c.account_id AND a.month_offset = c.month_offset
    ORDER BY c.account_code, c.month_offset
  `.compile(db));

  return res.rows.map(r => ({
    account_id: r.account_id,
    account_code: r.account_code,
    account_name: r.account_name,
    month_offset: r.month_offset,
    budget: toMoneyString(r.budget),
    actual: toMoneyString(r.actual),
    variance: toMoneyString(subMoney(r.actual, r.budget)),
  }));
}
