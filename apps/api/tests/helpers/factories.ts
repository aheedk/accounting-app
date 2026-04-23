// apps/api/tests/helpers/factories.ts
import { Kysely, sql } from 'kysely';
import type { DB, UserRole, AccountType } from '../../src/db/types.js';
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

export async function makeAccount(
  db: Kysely<DB>,
  business_id: string,
  opts: Partial<{ code: string; name: string; account_type: AccountType; is_system: boolean }> = {},
) {
  const code = opts.code ?? `ACC${Math.floor(Math.random() * 1_000_000).toString().padStart(6, '0')}`;
  return db.insertInto('chart_of_accounts').values({
    business_id,
    code,
    name: opts.name ?? `Account ${code}`,
    account_type: opts.account_type ?? 'asset',
    is_system: opts.is_system ?? false,
  }).returningAll().executeTakeFirstOrThrow();
}

export async function seedCoa(db: Kysely<DB>, business_id: string) {
  await sql`SELECT seed_default_coa(${business_id}::uuid)`.execute(db);
}

export async function makePeriod(
  db: Kysely<DB>,
  business_id: string,
  starts_on: string,
  ends_on: string,
  status: 'open' | 'closed' = 'open',
) {
  return db.insertInto('fiscal_periods').values({
    business_id, starts_on, ends_on, status,
  }).returningAll().executeTakeFirstOrThrow();
}

export async function seedYearPeriods(db: Kysely<DB>, business_id: string, year: number) {
  await sql`SELECT seed_calendar_year_periods(${business_id}::uuid, ${year}::int)`.execute(db);
}

export async function makeCustomer(db: Kysely<DB>, business_id: string, opts: Partial<{ name: string; email: string | null }> = {}) {
  return db.insertInto('customers').values({
    business_id,
    name: opts.name ?? `Customer ${Math.random().toString(36).slice(2, 8)}`,
    email: opts.email ?? null,
  }).returningAll().executeTakeFirstOrThrow();
}

export async function makeTaxCode(
  db: Kysely<DB>, business_id: string, tax_payable_account_id: string,
  opts: Partial<{ code: string; name: string; rate: number }> = {},
) {
  const tc = await db.insertInto('tax_codes').values({
    business_id,
    code: opts.code ?? 'TAX',
    name: opts.name ?? 'Sales Tax',
    tax_payable_account_id,
  }).returningAll().executeTakeFirstOrThrow();
  await db.insertInto('tax_rates').values({
    tax_code_id: tc.id,
    rate: String(opts.rate ?? 0.0875),
    effective_from: '2000-01-01',
  }).execute();
  return tc;
}

export async function makeVendor(
  db: Kysely<DB>,
  business_id: string,
  opts: Partial<{ name: string; email: string | null; is_1099: boolean }> = {},
) {
  return db.insertInto('vendors').values({
    business_id,
    name: opts.name ?? `Vendor ${Math.random().toString(36).slice(2, 8)}`,
    email: opts.email ?? null,
    is_1099: opts.is_1099 ?? false,
  }).returningAll().executeTakeFirstOrThrow();
}
