import 'dotenv/config';
import crypto from 'node:crypto';
import { Pool } from 'pg';
import { hashPassword } from '../apps/api/src/services/auth/passwordHasher.js';

// Logins for trying the app as each role: `npm run db:role-users`.
//
// Creates (or resets) accountant@, staff@, viewer@ and client@roletest.local in the first
// firm, each with access to one client, and prints one freshly made password
// for the three. Local databases only: these are throwaway logins with a
// password printed to the terminal, which has no place in a real firm's users.

const ROLES = ['accountant', 'staff', 'viewer', 'client'] as const;

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error(`Refusing to create test logins on ${url.hostname}. This is for a local database.`);
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const firm = await pool.query<{ firm_id: string }>(
    `SELECT firm_id FROM users WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1`);
  if (firm.rowCount === 0) throw new Error('No users yet. Run `npm run db:seed` first.');
  const firmId = firm.rows[0]!.firm_id;

  const businesses = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM businesses WHERE firm_id = $1 AND deleted_at IS NULL ORDER BY name`, [firmId]);
  // Green Gadgets is the client the demo notes use; any client will do.
  const business = businesses.rows.find(b => /green gadgets/i.test(b.name)) ?? businesses.rows[0];
  if (!business) throw new Error('No client company yet. Run `npm run db:seed` first.');

  const password = crypto.randomBytes(12).toString('base64url');
  const hash = await hashPassword(password);

  for (const role of ROLES) {
    const email = `${role}@roletest.local`;
    const existing = await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email]);
    const id = existing.rows[0]?.id ?? (await pool.query<{ id: string }>(
      `INSERT INTO users (firm_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [firmId, email, hash, `Test ${role[0]!.toUpperCase()}${role.slice(1)}`, role])).rows[0]!.id;
    await pool.query(`UPDATE users SET password_hash = $2, role = $3, deleted_at = NULL WHERE id = $1`, [id, hash, role]);
    const granted = await pool.query(
      `SELECT 1 FROM user_business_access WHERE user_id = $1 AND business_id = $2`, [id, business.id]);
    if (granted.rowCount === 0) {
      await pool.query(`INSERT INTO user_business_access (user_id, business_id) VALUES ($1, $2)`, [id, business.id]);
    }
  }

  console.log(`Test logins for ${business.name}:`);
  for (const role of ROLES) console.log(`  ${role}@roletest.local`);
  console.log(`  password (all of them): ${password}`);
  console.log('Run this again to change the password.');
  await pool.end();
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
