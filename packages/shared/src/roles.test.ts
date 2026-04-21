import { describe, it, expect } from 'vitest';
import { ROLES, ROLE_RANK, hasMinRole } from './roles.js';

describe('roles', () => {
  it('ranks firm_admin highest, client lowest', () => {
    expect(ROLE_RANK[ROLES.FIRM_ADMIN]).toBeGreaterThan(ROLE_RANK[ROLES.ACCOUNTANT]);
    expect(ROLE_RANK[ROLES.ACCOUNTANT]).toBeGreaterThan(ROLE_RANK[ROLES.STAFF]);
    expect(ROLE_RANK[ROLES.STAFF]).toBeGreaterThan(ROLE_RANK[ROLES.CLIENT]);
  });

  it('hasMinRole: accountant meets accountant', () => {
    expect(hasMinRole('accountant', 'accountant')).toBe(true);
  });

  it('hasMinRole: staff does not meet accountant', () => {
    expect(hasMinRole('staff', 'accountant')).toBe(false);
  });

  it('hasMinRole: firm_admin meets everything', () => {
    expect(hasMinRole('firm_admin', 'client')).toBe(true);
    expect(hasMinRole('firm_admin', 'firm_admin')).toBe(true);
  });
});
