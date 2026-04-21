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

// A long-lived instance used by routes. Constructed lazily on first access so
// tests can rebind `process.env.DATABASE_URL` (e.g. to a testcontainer URL)
// before the singleton is materialized. Tests can also create their own via
// makeDb(). Reads `process.env.DATABASE_URL` at first access rather than the
// already-parsed `config.DATABASE_URL` so test rebinding actually takes effect.
let _db: Kysely<DB> | null = null;
function getDb(): Kysely<DB> {
  if (!_db) _db = makeDb(process.env.DATABASE_URL ?? config.DATABASE_URL);
  return _db;
}

export const db: Kysely<DB> = new Proxy({} as Kysely<DB>, {
  get(_t, prop, recv) {
    const real = getDb() as unknown as Record<PropertyKey, unknown>;
    const value = Reflect.get(real, prop, recv);
    return typeof value === 'function' ? value.bind(real) : value;
  },
});

// Test-only: dispose the lazy singleton so its pg pool is closed cleanly. Used
// by HTTP-route integration tests that share a testcontainer DB with the
// singleton via `process.env.DATABASE_URL`.
export async function destroyDbSingleton(): Promise<void> {
  if (_db) {
    const inst = _db;
    _db = null;
    await inst.destroy();
  }
}

export type { DB };
