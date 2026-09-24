// apps/api/tests/helpers/testDb.ts
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import type { DB } from '../../src/db/types.js';

pg.types.setTypeParser(1700, (val) => val);
// Parse `date` (OID 1082) as STRING (YYYY-MM-DD) instead of JS Date so it
// matches the kysely ColumnType<string, ...> contract used in db/types.ts.
pg.types.setTypeParser(1082, (val) => val);


export type TestDb = {
  pool: pg.Pool;
  db: Kysely<DB>;
  url: string;
};

let shared: TestDb | null = null;

/**
 * Connect to the run-wide Postgres started by tests/helpers/globalSetup.ts.
 *
 * This no longer starts a container or runs migrations -- globalSetup does both
 * once for the whole run. Files share the database and run sequentially, and
 * each file truncates between tests.
 */
export async function startTestDb(): Promise<TestDb> {
  if (shared) return shared;
  const url = process.env['TEST_DATABASE_URL'];
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Run these tests through vitest so '
      + 'tests/helpers/globalSetup.ts can start the shared database.',
    );
  }
  const pool = new pg.Pool({ connectionString: url });
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  shared = { pool, db, url };
  return shared;
}

export async function stopTestDb(): Promise<void> {
  if (!shared) return;
  // Kysely's db.destroy() ends the underlying pg pool that PostgresDialect owns.
  // Calling pool.end() again would throw "Called end on pool more than once".
  // The container itself is stopped by globalSetup's teardown.
  await shared.db.destroy();
  shared = null;
}

// Wipe row data between tests but keep schema. Faster than recreating container.
export async function truncateAll(db: Kysely<DB>) {
  await sql`
    TRUNCATE
      account_coding_memory,
      bank_import_batches,
      numbering_counters,
      compliance_items,
      payroll_tax_liabilities,
      pay_run_lines,
      pay_runs,
      employees,
      budget_lines,
      budgets,
      custom_report_definitions,
      shipping_labels,
      sales_order_lines,
      sales_orders,
      item_receipts,
      purchase_order_lines,
      purchase_orders,
      integration_inbox,
      receipts,
      files,
      recurring_templates,
      period_review_tasks,
      expense_transactions,
      depreciation_entries,
      fixed_assets,
      bank_transaction_rules,
      bank_transactions,
      bank_reconciliations,
      bank_accounts,
      bill_payment_applications,
      bill_payments,
      vendor_credits,
      bill_lines,
      bills,
      vendors,
      payment_applications,
      credit_memos,
      payments,
      invoice_lines,
      invoices,
      tax_rates,
      tax_codes,
      customers,
      journal_entry_lines,
      journal_entries,
      fiscal_periods,
      chart_of_accounts,
      audit_logs,
      refresh_tokens,
      user_business_access,
      users,
      businesses,
      firms
    RESTART IDENTITY CASCADE;
  `.execute(db);
}
