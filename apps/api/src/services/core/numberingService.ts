import { sql, type Transaction } from 'kysely';
import type { DB } from '../../db/types.js';

export type NumberedEntityType = 'invoice' | 'bill' | 'purchase_order' | 'sales_order';

/**
 * Race-safe per-business document numbering. The atomic upsert increments the
 * counter row under its row lock, so concurrent transactions serialize instead
 * of colliding the way the old count(*)+1 helpers could.
 *
 * Note: user-typed numbers can still collide with generated ones; callers keep
 * their DUPLICATE_RESOURCE guards for that (pre-existing behavior).
 */
export async function nextNumber(
  trx: Transaction<DB>,
  business_id: string,
  entity_type: NumberedEntityType,
  prefix: string,
): Promise<string> {
  const row = await trx.insertInto('numbering_counters')
    .values({ business_id, entity_type, last_value: 1 })
    .onConflict(oc => oc.columns(['business_id', 'entity_type'])
      .doUpdateSet({ last_value: sql`numbering_counters.last_value + 1` }))
    .returning('last_value')
    .executeTakeFirstOrThrow();
  return `${prefix}-${String(Number(row.last_value)).padStart(4, '0')}`;
}

/**
 * Raw-counter variant of the same upsert; returns the bare integer so callers
 * format the number themselves. Shares numbering_counters rows with nextNumber,
 * so the two never hand out the same value for an entity_type. last_value may
 * come back as a string (bigint column), hence the Number() coercion.
 */
export async function nextCounter(
  trx: Transaction<DB>,
  business_id: string,
  entity_type: string,
): Promise<number> {
  const result = await sql<{ last_value: string | number }>`
    INSERT INTO numbering_counters (business_id, entity_type, last_value)
    VALUES (${business_id}, ${entity_type}, 1)
    ON CONFLICT (business_id, entity_type) DO UPDATE
      SET last_value = numbering_counters.last_value + 1
    RETURNING last_value
  `.execute(trx);
  return Number(result.rows[0]!.last_value);
}
