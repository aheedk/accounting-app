export const ROLES = {
  FIRM_ADMIN: 'firm_admin',
  ACCOUNTANT: 'accountant',
  STAFF: 'staff',
  CLIENT: 'client',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_RANK: Record<Role, number> = {
  firm_admin: 40,
  accountant: 30,
  staff: 20,
  client: 10,
};

export function hasMinRole(actual: Role, required: Role): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}
