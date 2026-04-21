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

  await pool.end();
  console.log('Migrations complete.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
