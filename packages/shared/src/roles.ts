export const ROLES = {
  FIRM_ADMIN: 'firm_admin',
  ACCOUNTANT: 'accountant',
  STAFF: 'staff',
  // Reads everything staff read and changes nothing: a reviewer or an auditor.
  VIEWER: 'viewer',
  CLIENT: 'client',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_RANK: Record<Role, number> = {
  firm_admin: 40,
  accountant: 30,
  staff: 20,
  viewer: 15,
  client: 10,
};

export function hasMinRole(actual: Role, required: Role): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

/** How each role reads on screen. */
export const ROLE_LABELS: Record<Role, string> = {
  firm_admin: 'Firm admin',
  accountant: 'Accountant',
  staff: 'Staff',
  viewer: 'View only',
  client: 'Client',
};
