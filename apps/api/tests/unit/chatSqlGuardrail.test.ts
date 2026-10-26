import { describe, expect, it } from 'vitest';
import { validateReadOnlySql } from '../../src/services/ai/chatSqlGuardrail.js';

describe('validateReadOnlySql', () => {
  it('accepts a well-formed, tenant-scoped SELECT over an allowed table', () => {
    const result = validateReadOnlySql(
      "SELECT code, name FROM chart_of_accounts WHERE business_id = $1 AND account_type = 'expense'",
    );
    expect(result).toEqual({ ok: true, sql: expect.stringContaining('SELECT') });
  });

  it('accepts a WITH (CTE) query', () => {
    const result = validateReadOnlySql(
      'WITH x AS (SELECT * FROM invoices WHERE business_id = $1) SELECT * FROM x',
    );
    expect(result.ok).toBe(true);
  });

  it('allows one trailing semicolon', () => {
    const result = validateReadOnlySql('SELECT * FROM invoices WHERE business_id = $1;');
    expect(result.ok).toBe(true);
  });

  it.each(['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'TRUNCATE', 'CREATE', 'GRANT', 'REVOKE'])(
    'rejects %s even disguised inside a SELECT-shaped string',
    keyword => {
      const result = validateReadOnlySql(`SELECT * FROM invoices WHERE business_id = $1; ${keyword} TABLE x`);
      expect(result.ok).toBe(false);
    },
  );

  it('rejects a query that does not start with SELECT or WITH', () => {
    const result = validateReadOnlySql("UPDATE invoices SET status = 'voided' WHERE business_id = $1");
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('SELECT') });
  });

  it('rejects stacked statements', () => {
    const result = validateReadOnlySql(
      "SELECT * FROM invoices WHERE business_id = $1; DELETE FROM invoices WHERE business_id = $1",
    );
    expect(result.ok).toBe(false);
  });

  it('rejects comments (which could hide a second statement from a naive filter)', () => {
    const result = validateReadOnlySql('SELECT * FROM invoices WHERE business_id = $1 -- DROP TABLE invoices');
    expect(result.ok).toBe(false);
  });

  it('rejects a query missing the $1 business_id parameter', () => {
    const result = validateReadOnlySql('SELECT * FROM invoices');
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('$1') });
  });

  it('rejects a query that references a table outside the allow-list', () => {
    const result = validateReadOnlySql('SELECT * FROM users WHERE business_id = $1');
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('users') });
  });

  it('rejects a query reaching for a system catalog', () => {
    const result = validateReadOnlySql('SELECT * FROM pg_catalog.pg_tables WHERE business_id = $1');
    expect(result.ok).toBe(false);
  });

  it('rejects an empty query', () => {
    expect(validateReadOnlySql('')).toEqual({ ok: false, reason: expect.any(String) });
    expect(validateReadOnlySql('   ')).toEqual({ ok: false, reason: expect.any(String) });
  });

  it('rejects a query that filters business_id on a hardcoded literal while using $1 for something unrelated', () => {
    // Caught during review: an earlier version of this guardrail only
    // checked that "$1" appeared *somewhere* in the query, which this case
    // would have slipped past — a real cross-tenant read, since business_id
    // itself is pinned to a literal (potentially another business's id)
    // while $1 (bound to the real caller's businessId) filters an unrelated
    // column. Fixed by requiring business_id itself to be compared directly
    // against $1, not just checking $1's mere presence.
    const result = validateReadOnlySql(
      "SELECT * FROM invoices WHERE business_id = '11111111-1111-1111-1111-111111111111' AND total > $1",
    );
    expect(result.ok).toBe(false);
  });

  it.each(['pg_sleep(100)', 'pg_terminate_backend(1)', 'dblink(\'...\')'])(
    'rejects a call to %s',
    call => {
      const result = validateReadOnlySql(`SELECT ${call} FROM invoices WHERE business_id = $1`);
      expect(result.ok).toBe(false);
    },
  );
});
