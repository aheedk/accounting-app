import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIG_DIR = path.resolve(__dirname, '../db/migrations');

async function main() {
  const reset = process.argv.includes('--reset');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  if (reset) {
    console.log('Resetting database (DROP SCHEMA public CASCADE)…');
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const files = (await fs.readdir(MIG_DIR))
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const applied = await pool.query('SELECT 1 FROM _migrations WHERE name = $1', [file]);
    if ((applied.rowCount ?? 0) > 0) {
      console.log(`SKIP  ${file}`);
      continue;
    }
    console.log(`APPLY ${file}`);
    const sql = await fs.readFile(path.join(MIG_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _migrations(name) VALUES ($1)', [file]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`FAIL  ${file}`);
      throw err;
    } finally {
      client.release();
    }
  }

  // Supabase's Data API reaches the tables in public as the roles anon and
  // authenticated, and the key it takes is public. The app never uses it, so
  // those roles get nothing here; on every run, so new tables are covered too.
  // Where the roles do not exist (local, CI) this does nothing.
  const supabaseRoles = await pool.query(
    "SELECT 1 FROM pg_roles WHERE rolname IN ('anon', 'authenticated')",
  );
  if (supabaseRoles.rowCount === 2) {
    await pool.query(`
      REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
      REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
      REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
    `);
    console.log('Supabase roles anon and authenticated: no access to public.');
  }

  await pool.end();
  console.log('Migrations complete.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
