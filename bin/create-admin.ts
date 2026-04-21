import 'dotenv/config';
import { Pool } from 'pg';
import bcrypt from 'bcrypt';

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const firm_name = process.env.ADMIN_FIRM_NAME ?? 'Acme Accounting LLC';
  const full_name = process.env.ADMIN_FULL_NAME ?? 'Admin';

  if (!email || !password) {
    console.error('ADMIN_EMAIL and ADMIN_PASSWORD env vars are required');
    process.exit(1);
  }
  if (password.length < 12) {
    console.error('ADMIN_PASSWORD must be at least 12 chars');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const firm = await pool.query(`SELECT id FROM firms WHERE name = $1`, [firm_name]);
  let firm_id: string;
  if (firm.rowCount === 0) {
    const r = await pool.query(`INSERT INTO firms (name) VALUES ($1) RETURNING id`, [firm_name]);
    firm_id = r.rows[0].id;
  } else firm_id = firm.rows[0].id;

  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    `INSERT INTO users (firm_id, email, password_hash, full_name, role)
     VALUES ($1, $2, $3, $4, 'firm_admin')
     ON CONFLICT (firm_id, email) WHERE deleted_at IS NULL
     DO UPDATE SET password_hash = EXCLUDED.password_hash, full_name = EXCLUDED.full_name`,
    [firm_id, email, hash, full_name],
  );
  await pool.end();
  console.log(`Admin ${email} ensured on firm ${firm_name}`);
}

main().catch(err => { console.error(err); process.exit(1); });
