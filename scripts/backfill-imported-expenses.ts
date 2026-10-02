/**
 * One-off backfill: wrap every existing AI-coded "expense"/"check" journal
 * entry (source_type = 'bank_import', posted from the email/statement import
 * pipeline before expense_transactions supported wrapping) in an
 * expense_transactions + expense_transaction_lines record, so it's viewable
 * on the Expense page instead of only the raw import-review form. Mirrors
 * expenseTransactionService.wrapImportedExpenseJournalEntry exactly (kept in
 * sync by hand since this script runs standalone via `pg`, not through the
 * compiled API service layer) — non-destructive, idempotent (skips JEs that
 * already have a wrapper), one transaction per JE so one bad row can't block
 * the rest. All lookups are batched up front so a slow remote connection
 * doesn't have to survive ~2 round trips per row.
 *
 * emailImports.ts always posts the bank/payment-side line first (line_number
 * 1) and the category/offset side second, so that position is trusted rather
 * than searching for a match.
 *
 * Usage: tsx --env-file=.env scripts/backfill-imported-expenses.ts [--dry-run]
 */
import { Pool } from 'pg';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });

  const candidates = await pool.query<{
    je_id: string; business_id: string; entry_date: string; memo: string | null;
    transaction_type: string | null; payee_name: string | null;
  }>(`
    SELECT je.id AS je_id, je.business_id, je.entry_date::text, je.memo, je.transaction_type, je.payee_name
    FROM journal_entries je
    WHERE je.source_type = 'bank_import'
      AND je.transaction_type IN ('check', 'expense')
      AND je.status = 'posted'
      AND NOT EXISTS (SELECT 1 FROM expense_transactions et WHERE et.journal_entry_id = je.id)
    ORDER BY je.entry_date
  `);
  console.log(`Found ${candidates.rows.length} unwrapped imported expense(s)/check(s).`);
  if (candidates.rows.length === 0) { await pool.end(); return; }

  const jeIds = candidates.rows.map(r => r.je_id);
  const bizIds = [...new Set(candidates.rows.map(r => r.business_id))];

  const allLines = await pool.query<{
    journal_entry_id: string; account_id: string; debit: string; credit: string; memo: string | null;
  }>(
    `SELECT journal_entry_id, account_id, debit, credit, memo FROM journal_entry_lines
     WHERE journal_entry_id = ANY($1::uuid[]) ORDER BY journal_entry_id, line_number`,
    [jeIds],
  );
  const linesByJe = new Map<string, typeof allLines.rows>();
  for (const l of allLines.rows) {
    const arr = linesByJe.get(l.journal_entry_id) ?? [];
    arr.push(l);
    linesByJe.set(l.journal_entry_id, arr);
  }

  const firms = await pool.query<{ id: string; firm_id: string }>(
    `SELECT id, firm_id FROM businesses WHERE id = ANY($1::uuid[])`, [bizIds],
  );
  const firmByBusiness = new Map(firms.rows.map(r => [r.id, r.firm_id]));

  let wrapped = 0;
  let skippedBadLineCount = 0;

  for (const je of candidates.rows) {
    const lines = linesByJe.get(je.je_id) ?? [];
    if (lines.length !== 2) {
      console.warn(`SKIP ${je.je_id}: expected 2 lines, found ${lines.length}`);
      skippedBadLineCount++;
      continue;
    }

    const paymentLine = lines[0]!;
    const categoryLine = lines[1]!;
    const amount = String(Math.max(parseFloat(categoryLine.debit), parseFloat(categoryLine.credit)));
    const description = je.memo ?? categoryLine.memo ?? '';
    const payeeText = je.payee_name?.trim() || description || 'Imported expense';
    const paymentMethod = je.transaction_type === 'check' ? 'check' : 'other';

    if (dryRun) {
      console.log(`DRY-RUN would wrap ${je.je_id} (${je.entry_date}, $${amount}, ${je.transaction_type})`);
      wrapped++;
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const expense = await client.query<{ id: string }>(
        `INSERT INTO expense_transactions
           (business_id, transaction_date, payee_text, payment_account_id, payment_method, memo, total_amount, status, journal_entry_id, posted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'posted', $8, now())
         RETURNING id`,
        [je.business_id, je.entry_date, payeeText, paymentLine.account_id, paymentMethod, description, amount, je.je_id],
      );
      const expenseId = expense.rows[0]!.id;

      await client.query(
        `INSERT INTO expense_transaction_lines
           (expense_transaction_id, business_id, category_account_id, description, amount, sort_order)
         VALUES ($1, $2, $3, $4, $5, 0)`,
        [expenseId, je.business_id, categoryLine.account_id, description, amount],
      );

      await client.query(
        `INSERT INTO audit_logs (firm_id, business_id, action, entity_type, entity_id, before_state, after_state)
         VALUES ($1, $2, 'expense_transaction.create', 'expense_transaction', $3, NULL, $4::jsonb)`,
        [firmByBusiness.get(je.business_id), je.business_id, expenseId, JSON.stringify({ id: expenseId, journal_entry_id: je.je_id, backfilled: true })],
      );

      await client.query('COMMIT');
      wrapped++;
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`FAIL ${je.je_id}:`, err instanceof Error ? err.message : err);
    } finally {
      client.release();
    }
  }

  console.log(`Wrapped ${wrapped} expense(s)/check(s). Skipped ${skippedBadLineCount} (bad line count).`);
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
