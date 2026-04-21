import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { Pool } from 'pg';
import bcrypt from 'bcrypt';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_DIR = path.resolve(__dirname, '../db/seeds');

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Run SQL seed files in order
  const files = (await fs.readdir(SEED_DIR)).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = await fs.readFile(path.join(SEED_DIR, f), 'utf8');
    console.log(`APPLY ${f}`);
    await pool.query(sql);
  }

  // Ensure a firm_admin user exists
  const firmRow = await pool.query(`SELECT id FROM firms WHERE name = 'Acme Accounting LLC'`);
  if (firmRow.rowCount === 0) throw new Error('Seed firm missing');
  const firm_id = firmRow.rows[0].id;

  const existing = await pool.query(`SELECT id FROM users WHERE email = 'admin@example.com' AND firm_id = $1`, [firm_id]);
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

    // Grant admin access to all businesses
    const bizs = await pool.query(`SELECT id FROM businesses WHERE firm_id = $1`, [firm_id]);
    const userRow = await pool.query(`SELECT id FROM users WHERE email = 'admin@example.com' AND firm_id = $1`, [firm_id]);
    for (const b of bizs.rows) {
      await pool.query(
        `INSERT INTO user_business_access (user_id, business_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userRow.rows[0].id, b.id],
      );
    }
  } else {
    console.log('Admin user already exists, skipping password generation.');
  }

  await pool.end();
  console.log('Seed complete.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
