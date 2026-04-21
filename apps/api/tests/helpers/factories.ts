// apps/api/tests/helpers/factories.ts
import { Kysely } from 'kysely';
import type { DB, UserRole } from '../../src/db/types.js';
import { hashPassword } from '../../src/services/auth/passwordHasher.js';

export async function makeFirm(db: Kysely<DB>, name = 'Test Firm'): Promise<{ id: string; name: string }> {
  const row = await db.insertInto('firms').values({ name }).returningAll().executeTakeFirstOrThrow();
  return { id: row.id, name: row.name };
}

export async function makeBusiness(db: Kysely<DB>, firm_id: string, name = 'Test Business') {
  const row = await db.insertInto('businesses').values({ firm_id, name }).returningAll().executeTakeFirstOrThrow();
  return row;
}

export async function makeUser(
  db: Kysely<DB>,
  firm_id: string,
  opts: { email?: string; password?: string; role?: UserRole; full_name?: string } = {},
) {
  const {
    email = `user-${Math.random().toString(36).slice(2, 8)}@example.com`,
    password = 'test-password-123',
    role = 'accountant',
    full_name = 'Test User',
  } = opts;
  const password_hash = await hashPassword(password);
  const row = await db.insertInto('users')
    .values({ firm_id, email, password_hash, full_name, role })
    .returningAll()
    .executeTakeFirstOrThrow();
  return { ...row, plaintext_password: password };
}

export async function grantAccess(db: Kysely<DB>, user_id: string, business_id: string, role_override: UserRole | null = null) {
  return db.insertInto('user_business_access')
    .values({ user_id, business_id, role_override })
    .returningAll()
    .executeTakeFirstOrThrow();
}
