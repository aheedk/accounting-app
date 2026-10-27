import { CompiledQuery, sql, type Kysely } from 'kysely';
import type { DB } from '../../db/types.js';
import { validateReadOnlySql } from './chatSqlGuardrail.js';

const QUERY_TIMEOUT_MS = 5000;
const ROW_LIMIT = 500;

export class UnsafeQueryError extends Error {}

/**
 * Runs one LLM-generated SQL string, read-only and tenant-scoped.
 *
 * Layered guardrails, each independent of the others:
 *  1. `validateReadOnlySql` — static text checks (single statement, no
 *     comments, SELECT/WITH only, no DDL/DML keywords, references only the
 *     allow-listed tables, uses $1 for business_id).
 *  2. `SET TRANSACTION READ ONLY` — the actual enforcement. Even if (1)
 *     somehow let a write through, Postgres itself refuses it inside this
 *     transaction. This is the backstop that matters.
 *  3. `businessId` is always a bind parameter via `CompiledQuery.raw`'s own
 *     parameters array (sent to Postgres separately from the query text),
 *     never string-interpolated — standard parameterized-query protection
 *     against the LLM-authored SQL text itself.
 *  4. A 5s statement timeout and a 500-row cap (the latter enforced in JS
 *     too, so it holds even if the query already has its own LIMIT).
 */
export async function runReadOnlyQuery(
  db: Kysely<DB>, businessId: string, rawSql: string,
): Promise<Record<string, unknown>[]> {
  const result = validateReadOnlySql(rawSql);
  if (!result.ok) throw new UnsafeQueryError(result.reason);

  return db.transaction().execute(async trx => {
    await sql`SET TRANSACTION READ ONLY`.execute(trx);
    await sql.raw(`SET LOCAL statement_timeout = ${QUERY_TIMEOUT_MS}`).execute(trx);
    const { rows } = await trx.executeQuery<Record<string, unknown>>(
      CompiledQuery.raw(result.sql, [businessId]),
    );
    return rows.slice(0, ROW_LIMIT);
  });
}
