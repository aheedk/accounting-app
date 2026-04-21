import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { config } from '../config.js';
import type { DB } from './types.js';

// Parse numeric (OID 1700) as a STRING, not JS number — preserves precision.
// Uses pg.types.setTypeParser; safe to run at module load.
pg.types.setTypeParser(1700, (val) => val);

export function makeDb(connectionString = config.DATABASE_URL): Kysely<DB> {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}

// A long-lived instance used by routes. Tests create their own via makeDb().
export const db: Kysely<DB> = makeDb();

export type { DB };
