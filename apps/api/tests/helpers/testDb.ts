// apps/api/tests/helpers/testDb.ts
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import type { DB } from '../../src/db/types.js';

pg.types.setTypeParser(1700, (val) => val);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIG_DIR = path.resolve(__dirname, '../../../../db/migrations');

export type TestDb = {
  container: StartedPostgreSqlContainer;
  pool: pg.Pool;
  db: Kysely<DB>;
  url: string;
};

let shared: TestDb | null = null;

export async function startTestDb(): Promise<TestDb> {
  if (shared) return shared;
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('accounting')
    .withUsername('accounting')
    .withPassword('accounting')
    .start();
  const url = container.getConnectionUri();
  const pool = new pg.Pool({ connectionString: url });
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  await runMigrations(pool);
  shared = { container, pool, db, url };
  return shared;
}

export async function stopTestDb(): Promise<void> {
  if (!shared) return;
  // Kysely's db.destroy() ends the underlying pg pool that PostgresDialect owns.
  // Calling pool.end() again would throw "Called end on pool more than once".
  await shared.db.destroy();
  await shared.container.stop();
  shared = null;
}

async function runMigrations(pool: pg.Pool) {
  const files = (await fs.readdir(MIG_DIR)).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    const text = await fs.readFile(path.join(MIG_DIR, file), 'utf8');
    await pool.query(text);
  }
}

// Wipe row data between tests but keep schema. Faster than recreating container.
export async function truncateAll(db: Kysely<DB>) {
  await sql`
    TRUNCATE
      audit_logs,
      refresh_tokens,
      user_business_access,
      users,
      businesses,
      firms
    RESTART IDENTITY CASCADE;
  `.execute(db);
}
