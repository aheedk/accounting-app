import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { config } from '../config.js';
import type { DB } from './types.js';

// Parse numeric (OID 1700) as a STRING, not JS number — preserves precision.
// Uses pg.types.setTypeParser; safe to run at module load.
pg.types.setTypeParser(1700, (val) => val);
// Parse date (OID 1082) as a STRING ('YYYY-MM-DD'), not JS Date — matches the
// kysely DB type contract for fiscal_periods.starts_on/ends_on, journal_entries.entry_date, etc.
pg.types.setTypeParser(1082, (val) => val);

// Tracks the pool behind the most recently created instance (the long-lived
// singleton below, in practice) so requestTiming can report live utilization
// — total/idle/waiting — on slow requests without plumbing the pool through
// every layer. Diagnostic only.
let lastPool: pg.Pool | null = null;
export function getPoolStats(): { total: number; idle: number; waiting: number } | null {
  if (!lastPool) return null;
  return { total: lastPool.totalCount, idle: lastPool.idleCount, waiting: lastPool.waitingCount };
}

export function makeDb(connectionString = config.DATABASE_URL): Kysely<DB> {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  });
  lastPool = pool;
  // Without this listener, Node.js throws idle-client errors as unhandled
  // exceptions and kills the process when the DB server closes a connection.
  pool.on('error', (err) => {
    console.error('[db] idle client error — connection will be replaced:', err.message);
  });
  // Diagnostic: pool.waitingCount only reflects callers queued because every
  // existing client is busy — it does NOT cover a brand-new physical
  // connection (TCP+TLS handshake to Railway) actively being established.
  // This times that separately, since totalCount climbing during the slow
  // requests suggests new-connection setup, not query execution, is where
  // the time is actually going.
  pool.on('connect', () => {
    console.warn(`[db] new physical connection established at ${new Date().toISOString()} (pool total=${pool.totalCount})`);
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
