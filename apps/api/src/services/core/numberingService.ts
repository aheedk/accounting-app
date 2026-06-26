import { sql, type Transaction } from 'kysely';
import type { DB } from '../../db/types.js';

/**
 * Atomically increments and returns the next counter value for a given
 * (business, entity_type) pair. Uses INSERT ... ON CONFLICT DO UPDATE so
 * concurrent callers inside the same transaction or across transactions
 * never observe the same value.
 */
export async function nextCounter(
  trx: Transaction<DB>,
  business_id: string,
  entity_type: string,
): Promise<number> {
  const result = await sql<{ last_value: number }>`
    INSERT INTO numbering_counters (business_id, entity_type, last_value)
    VALUES (${business_id}, ${entity_type}, 1)
    ON CONFLICT (business_id, entity_type) DO UPDATE
      SET last_value = numbering_counters.last_value + 1
    RETURNING last_value
  `.execute(trx);
  return result.rows[0]!.last_value;
}
