/**
 * One-off backfill: wrap every existing AI-coded "deposit" journal entry
 * (source_type = 'bank_import', posted from the email/statement import
 * pipeline before bank_deposits existed) in a bank_deposits + bank_deposit_lines
 * record, so it's viewable on the Bank Deposit page instead of only the raw
 * Journal Entry page. Mirrors bankDepositService.wrapImportedDepositJournalEntry
 * exactly (kept in sync by hand since this script runs standalone via `pg`,
 * not through the compiled API service layer) — non-destructive, idempotent
 * (skips JEs that already have a wrapper), one transaction per JE so one bad
 * row can't block the rest. All lookups are batched up front so a slow remote
 * connection doesn't have to survive ~3 round trips per row.
 *
 * Businesses that never registered a bank_accounts row at all get one
 * auto-created from the GL cash account their deposit JEs already post to
 * (emailImports.ts always posts the bank-side line first, line_number 1, so
 * that account is unambiguous even with zero existing bank_accounts rows).
 *
 * Usage: tsx --env-file=.env scripts/backfill-imported-deposits.ts [--dry-run]
 */
import { Pool } from 'pg';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });

  const candidates = await pool.query<{
    je_id: string; business_id: string; entry_date: string; memo: string | null;
  }>(`
    SELECT je.id AS je_id, je.business_id, je.entry_date::text, je.memo
    FROM journal_entries je
    WHERE je.source_type = 'bank_import'
      AND je.transaction_type = 'deposit'
      AND je.status = 'posted'
      AND NOT EXISTS (SELECT 1 FROM bank_deposits bd WHERE bd.journal_entry_id = je.id)
    ORDER BY je.entry_date
  `);
  console.log(`Found ${candidates.rows.length} unwrapped imported deposit(s).`);
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

  const allBankAccounts = await pool.query<{ id: string; business_id: string; cash_account_id: string }>(
    `SELECT id, business_id, cash_account_id FROM bank_accounts WHERE business_id = ANY($1::uuid[]) AND deleted_at IS NULL`,
    [bizIds],
  );
  const bankAccountByCashAccount = new Map<string, { id: string }>();
  for (const ba of allBankAccounts.rows) bankAccountByCashAccount.set(`${ba.business_id}:${ba.cash_account_id}`, { id: ba.id });

  const accountNames = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM chart_of_accounts WHERE id = ANY($1::uuid[])`,
    [[...new Set(allLines.rows.map(l => l.account_id))]],
  );
  const accountNameById = new Map(accountNames.rows.map(r => [r.id, r.name]));

  const firms = await pool.query<{ id: string; firm_id: string }>(
    `SELECT id, firm_id FROM businesses WHERE id = ANY($1::uuid[])`, [bizIds],
  );
  const firmByBusiness = new Map(firms.rows.map(r => [r.id, r.firm_id]));

  let wrapped = 0;
  let skippedBadLineCount = 0;
  let autoCreatedBankAccounts = 0;

  for (const je of candidates.rows) {
    const lines = linesByJe.get(je.je_id) ?? [];
    if (lines.length !== 2) {
      console.warn(`SKIP ${je.je_id}: expected 2 lines, found ${lines.length}`);
      skippedBadLineCount++;
      continue;
    }

    // emailImports.ts always posts the bank-side line first (line_number 1) and
    // the offset second — trust that position rather than searching for a
    // bank_accounts match, which breaks when a "deposit" is actually a transfer
    // between two of the business's own registered bank accounts (both lines
    // would match, leaving no line to treat as the offset).
    const bankLine = lines[0]!;
    const offsetLine = lines[1]!;
    let bankAccountRow = bankAccountByCashAccount.get(`${je.business_id}:${bankLine.account_id}`) ?? null;
    const needsNewBankAccount = !bankAccountRow;

    const amount = String(Math.max(parseFloat(offsetLine.debit), parseFloat(offsetLine.credit)));
    const description = je.memo ?? offsetLine.memo ?? '';

    if (dryRun) {
      console.log(`DRY-RUN would wrap ${je.je_id} (${je.entry_date}, $${amount})${needsNewBankAccount ? ' [new bank account]' : ''}`);
      wrapped++;
      if (needsNewBankAccount) autoCreatedBankAccounts++;
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      if (needsNewBankAccount) {
        const name = accountNameById.get(bankLine.account_id) ?? 'Bank Account';
        const created = await client.query<{ id: string }>(
          `INSERT INTO bank_accounts (business_id, cash_account_id, name) VALUES ($1, $2, $3) RETURNING id`,
          [je.business_id, bankLine.account_id, name],
        );
        bankAccountRow = { id: created.rows[0]!.id };
        bankAccountByCashAccount.set(`${je.business_id}:${bankLine.account_id}`, bankAccountRow);
        autoCreatedBankAccounts++;
      }

      const counter = await client.query<{ last_value: string }>(
        `INSERT INTO numbering_counters (business_id, entity_type, last_value)
         VALUES ($1, 'bank_deposit', 1)
         ON CONFLICT (business_id, entity_type) DO UPDATE
           SET last_value = numbering_counters.last_value + 1
         RETURNING last_value`,
        [je.business_id],
      );
      const depositNumber = `DEP-${String(counter.rows[0]!.last_value).padStart(4, '0')}`;

      const deposit = await client.query<{ id: string }>(
        `INSERT INTO bank_deposits
           (business_id, bank_account_id, deposit_date, deposit_number, memo, total_amount, journal_entry_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [je.business_id, bankAccountRow!.id, je.entry_date, depositNumber, description, amount, je.je_id],
      );
      const depositId = deposit.rows[0]!.id;

      await client.query(
        `INSERT INTO bank_deposit_lines
           (deposit_id, business_id, line_type, account_id, description, amount, sort_order)
         VALUES ($1, $2, 'other_funds', $3, $4, $5, 0)`,
        [depositId, je.business_id, offsetLine.account_id, description, amount],
      );

      await client.query(
        `INSERT INTO audit_logs (firm_id, business_id, action, entity_type, entity_id, before_state, after_state)
         VALUES ($1, $2, 'bank_deposit.create', 'bank_deposit', $3, NULL, $4::jsonb)`,
        [firmByBusiness.get(je.business_id), je.business_id, depositId, JSON.stringify({ id: depositId, journal_entry_id: je.je_id, backfilled: true })],
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

  console.log(`Wrapped ${wrapped} deposit(s) (${autoCreatedBankAccounts} needed a new bank account registered). Skipped ${skippedBadLineCount} (bad line count).`);
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
