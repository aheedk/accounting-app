// Vitest globalSetup: stand up ONE Postgres container for the entire run and
// migrate it once, instead of one container per test file.
//
// Previously every test file called startTestDb(), which started its own
// testcontainer and replayed all migrations into it. With 69 files that meant
// 69 container boots competing for Docker, which regularly blew the 60s
// hookTimeout and left orphaned containers behind.
//
// The connection string is handed to the workers through TEST_DATABASE_URL.
// globalSetup runs in the main process before any worker is forked, so the
// workers inherit it. Test files share this one database, which is safe
// because they run sequentially (fileParallelism: false) and each file
// truncates between tests.
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIG_DIR = path.resolve(__dirname, '../../../../db/migrations');

let container: StartedPostgreSqlContainer | null = null;

export async function setup() {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('accounting')
    .withUsername('accounting')
    .withPassword('accounting')
    // A throwaway database: nothing in it needs to survive a crash, and without
    // these every truncate between tests waits on the disk (25-50 s each under
    // Docker Desktop on Windows, found 2026-11-09, which timed out the hooks).
    .withCommand(['postgres', '-c', 'fsync=off', '-c', 'synchronous_commit=off', '-c', 'full_page_writes=off'])
    .start();

  const url = container.getConnectionUri();
  const pool = new pg.Pool({ connectionString: url });
  try {
    const files = (await fs.readdir(MIG_DIR)).filter(f => f.endsWith('.sql')).sort();
    for (const file of files) {
      const text = await fs.readFile(path.join(MIG_DIR, file), 'utf8');
      await pool.query(text);
    }
  } finally {
    await pool.end();
  }

  process.env.TEST_DATABASE_URL = url;
}

export async function teardown() {
  await container?.stop();
  container = null;
}
