import { sql, type Kysely } from 'kysely';
import type { DB } from '../../db/types.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type PayrollOverview = {
  next_pay_date: string | null;       // earliest future pay_runs.pay_date among 'draft' status
  total_liabilities_outstanding: string;  // SUM accrued payroll_tax_liabilities
  last_pay_run_total: string;         // SUM of net on the most recent finalized pay run
  employee_count: number;
};

export async function getOverview(db: Kysely<DB>, ctx: ServiceCtx): Promise<PayrollOverview> {
  const business_id = ctx.business_id;
  if (!business_id) {
    return { next_pay_date: null, total_liabilities_outstanding: '0', last_pay_run_total: '0', employee_count: 0 };
  }

  const empCount = await db.executeQuery<{ cnt: number }>(sql<{ cnt: number }>`
    SELECT COUNT(*)::int AS cnt FROM employees
    WHERE business_id = ${business_id} AND deleted_at IS NULL AND is_active = true
  `.compile(db));

  const liab = await db.executeQuery<{ total: string }>(sql<{ total: string }>`
    SELECT COALESCE(SUM(amount), 0)::text AS total FROM payroll_tax_liabilities
    WHERE business_id = ${business_id} AND status = 'accrued'
  `.compile(db));

  const nextPay = await db.executeQuery<{ pay_date: string | null }>(sql<{ pay_date: string | null }>`
    SELECT MIN(pay_date)::text AS pay_date FROM pay_runs
    WHERE business_id = ${business_id} AND status = 'draft' AND pay_date >= now()::date
  `.compile(db));

  const lastRun = await db.executeQuery<{ total: string }>(sql<{ total: string }>`
    SELECT COALESCE(SUM(prl.net), 0)::text AS total
      FROM pay_run_lines prl
      JOIN pay_runs pr ON pr.id = prl.pay_run_id
     WHERE pr.business_id = ${business_id}
       AND pr.id = (
         SELECT id FROM pay_runs
          WHERE business_id = ${business_id} AND status = 'finalized'
          ORDER BY pay_date DESC LIMIT 1
       )
  `.compile(db));

  return {
    next_pay_date: nextPay.rows[0]?.pay_date ?? null,
    total_liabilities_outstanding: liab.rows[0]?.total ?? '0',
    last_pay_run_total: lastRun.rows[0]?.total ?? '0',
    employee_count: empCount.rows[0]?.cnt ?? 0,
  };
}
