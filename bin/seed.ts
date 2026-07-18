import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { Pool } from 'pg';
import bcrypt from 'bcrypt';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_DIR = path.resolve(__dirname, '../db/seeds');

// Seed files numbered <= this run before the admin user is created; files above
// it are demo data that may reference the admin user (owner_user_id, created_by,
// uploaded_by, etc.), so the user must already exist when they run.
const BASE_SEED_MAX = 6;

function seedNumber(file: string): number {
  const m = file.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

async function applyFile(pool: Pool, f: string): Promise<void> {
  const sql = await fs.readFile(path.join(SEED_DIR, f), 'utf8');
  console.log(`APPLY ${f}`);
  await pool.query(sql);
}

async function ensureAdminUser(pool: Pool): Promise<void> {
  const firmRow = await pool.query(`SELECT id FROM firms WHERE name = 'Acme Accounting LLC'`);
  if (firmRow.rowCount === 0) throw new Error('Seed firm missing');
  const firm_id = firmRow.rows[0].id;

  const existing = await pool.query(
    `SELECT id FROM users WHERE email = 'admin@example.com' AND firm_id = $1`,
    [firm_id],
  );
  if ((existing.rowCount ?? 0) === 0) {
    const password = crypto.randomBytes(12).toString('base64url');
    const hash = await bcrypt.hash(password, 12);
    await pool.query(
      `INSERT INTO users (firm_id, email, password_hash, full_name, role)
       VALUES ($1, 'admin@example.com', $2, 'Acme Admin', 'firm_admin')`,
      [firm_id, hash],
    );
    console.log('');
    console.log('=== SEED ADMIN CREDENTIALS (store these now — not printed again) ===');
    console.log('  email:    admin@example.com');
    console.log(`  password: ${password}`);
    console.log('===================================================================');
  } else {
    console.log('Admin user already exists, skipping password generation.');
  }

  // Grant admin access to every business (idempotent).
  const userRow = await pool.query(
    `SELECT id FROM users WHERE email = 'admin@example.com' AND firm_id = $1`,
    [firm_id],
  );
  const bizs = await pool.query(`SELECT id FROM businesses WHERE firm_id = $1`, [firm_id]);
  for (const b of bizs.rows) {
    await pool.query(
      `INSERT INTO user_business_access (user_id, business_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [userRow.rows[0].id, b.id],
    );
  }
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const files = (await fs.readdir(SEED_DIR)).filter(f => f.endsWith('.sql')).sort();
  const baseFiles = files.filter(f => seedNumber(f) <= BASE_SEED_MAX);
  const dataFiles = files.filter(f => seedNumber(f) > BASE_SEED_MAX);

  // 1) Foundation + reference data (firm, businesses, COA, periods, base masters).
  for (const f of baseFiles) await applyFile(pool, f);

  // 2) Admin user — demo data below may reference it as an owner/creator.
  await ensureAdminUser(pool);

  // 3) Demo transactional data across all sections, for every business.
  for (const f of dataFiles) await applyFile(pool, f);

  await pool.end();
  console.log('Seed complete.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
