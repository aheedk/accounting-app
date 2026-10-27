/**
 * Static validation of LLM-generated SQL before it's allowed anywhere near a
 * database connection. This is a pre-check, not the actual enforcement — the
 * real backstop is `SET TRANSACTION READ ONLY` in chatSqlEngine.ts, which
 * Postgres itself enforces regardless of what slips past the regex checks
 * here. No SQL-parsing library is used (a regex/token allow-list, not a new
 * dependency, per this repo's own "don't add a dependency to make it nicer"
 * rule) — that's exactly why the READ ONLY transaction matters: this layer
 * is defense in depth, not the only line of defense.
 */

const FORBIDDEN_KEYWORDS =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|COPY|CALL|VACUUM|REINDEX|EXECUTE|MERGE|LISTEN|NOTIFY|LOCK|SECURITY|pg_sleep|pg_terminate_backend|pg_cancel_backend|dblink|set_config)\b/i;

// The 11 schema areas the chat feature is allowed to read, plus the join
// tables that sit between them. Anything else (users, refresh_tokens,
// password_resets, pg_catalog/information_schema, ...) is refused even if
// the generated SQL is otherwise well-formed — the chat feature should never
// be the reason a table outside its own stated scope gets read.
export const CHAT_ALLOWED_TABLES = new Set([
  'chart_of_accounts',
  'journal_entries', 'journal_entry_lines',
  'invoices', 'invoice_lines',
  'bills', 'bill_lines',
  'expense_transactions', 'expense_transaction_lines',
  'customers', 'vendors',
  'bank_transactions',
  'bank_deposits', 'bank_deposit_lines',
  'payments', 'payment_applications',
  'bill_payments', 'bill_payment_applications',
  'fiscal_periods',
]);

export type SqlGuardrailResult = { ok: true; sql: string } | { ok: false; reason: string };

export function validateReadOnlySql(rawSql: string): SqlGuardrailResult {
  const trimmed = rawSql.trim();
  if (!trimmed) return { ok: false, reason: 'the query was empty' };

  // Allow one optional trailing semicolon; a semicolon anywhere else means
  // stacked statements, which is exactly the "single read-only SELECT" rule
  // this exists to enforce.
  const sql = trimmed.replace(/;\s*$/, '');
  if (sql.includes(';')) return { ok: false, reason: 'only a single statement is allowed' };

  // Comments can hide a second statement or a keyword from a naive filter;
  // simplest fix is to refuse them outright rather than try to strip them
  // safely.
  if (sql.includes('--') || sql.includes('/*')) return { ok: false, reason: 'comments are not allowed in the query' };

  if (!/^(SELECT|WITH)\b/i.test(sql)) return { ok: false, reason: 'only SELECT queries are allowed' };

  if (FORBIDDEN_KEYWORDS.test(sql)) return { ok: false, reason: 'the query contains a disallowed keyword' };

  // The model is instructed to filter by business_id using the bind
  // parameter $1, never a literal value. Checking that $1 merely appears
  // somewhere isn't enough — a query could satisfy that while filtering
  // business_id on a hardcoded literal elsewhere (a real cross-tenant leak
  // that's syntactically a "SELECT ... $1 ..." query). Require business_id
  // itself to be compared directly against $1.
  if (!/\bbusiness_id\s*=\s*\$1\b/i.test(sql) && !/\$1\s*=\s*business_id\b/i.test(sql)) {
    return { ok: false, reason: 'the query must filter business_id = $1 directly' };
  }

  // A CTE's own name (`WITH recent_bills AS (...)`) isn't a real table — a
  // later `FROM recent_bills` referencing it would otherwise be rejected as
  // an unknown table. Collect CTE names first so the allow-list check below
  // doesn't require them to be in CHAT_ALLOWED_TABLES too.
  const cteNames = new Set(
    [...sql.matchAll(/\bWITH\s+(?:RECURSIVE\s+)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s+AS\s*\(/gi),
      ...sql.matchAll(/,\s*"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s+AS\s*\(/gi)]
      .map(m => m[1]!.toLowerCase()),
  );

  const tableMatches = [...sql.matchAll(/\b(?:FROM|JOIN)\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi)];
  if (tableMatches.length === 0) return { ok: false, reason: 'no table reference was found in the query' };
  for (const match of tableMatches) {
    const table = match[1]!.toLowerCase();
    if (cteNames.has(table)) continue;
    if (!CHAT_ALLOWED_TABLES.has(table)) return { ok: false, reason: `table "${table}" is not available to the assistant` };
  }

  return { ok: true, sql };
}
