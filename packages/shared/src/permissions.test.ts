import { describe, expect, it } from 'vitest';
import {
  AREAS, apiPlaceOf, builtInPermissions, highestLevel, normalizePermissions, pagePlaceOf,
  roleForPage, roleForRequest, type Permissions,
} from './permissions.js';
import { customRoleCreateSchema } from './schemas/userManagement.js';

const all = (level: Permissions['sales']): Permissions =>
  Object.fromEntries(AREAS.map(area => [area, level])) as Permissions;

describe('custom role permissions', () => {
  it('a built-in role is one level everywhere; a client is not built from areas', () => {
    expect(builtInPermissions('staff')).toEqual(all('enter'));
    expect(builtInPermissions('firm_admin')).toEqual(all('full'));
    expect(builtInPermissions('client')).toBeNull();
  });

  it('a request takes the built-in role of the level in its area', () => {
    const role = { ...all('none'), sales: 'post', purchases: 'view' } as Permissions;
    expect(roleForRequest(role, 'POST', '/invoices/abc/post')).toEqual({ role: 'accountant' });
    expect(roleForRequest(role, 'POST', '/bills')).toEqual({ role: 'viewer' });
    expect(roleForRequest(role, 'GET', '/employees')).toEqual({ refused: ['payroll'] });
  });

  it('list lookups are read by any role with access; a record of one is its area', () => {
    const role = { ...all('none'), sales: 'enter' } as Permissions;
    expect(apiPlaceOf('GET', '/vendors')).toEqual({ kind: 'lookup' });
    expect(roleForRequest(role, 'GET', '/vendors')).toEqual({ role: 'viewer' });
    expect(roleForRequest(role, 'GET', '/vendors/abc')).toEqual({ refused: ['purchases'] });
    expect(roleForRequest(role, 'POST', '/vendors')).toEqual({ refused: ['purchases'] });
    expect(roleForRequest(all('none'), 'GET', '/')).toEqual({ refused: [] });
    // Reading the company's name is a lookup; changing its settings is Company.
    expect(roleForRequest(role, 'PATCH', '/')).toEqual({ refused: ['company'] });
  });

  it('attachments go with the highest level, at most Enter', () => {
    expect(roleForRequest({ ...all('none'), banking: 'full' } as Permissions, 'POST', '/files')).toEqual({ role: 'staff' });
    expect(roleForRequest({ ...all('none'), reports: 'view' } as Permissions, 'POST', '/receipts')).toEqual({ role: 'viewer' });
  });

  it('the AI chat needs every area it reads, and acts at the lowest', () => {
    const role = { ...all('post'), banking: 'view' } as Permissions;
    expect(roleForRequest(role, 'POST', '/chat')).toEqual({ role: 'viewer' });
    expect(roleForRequest({ ...role, sales: 'none' }, 'POST', '/chat')).toEqual({ refused: ['sales'] });
  });

  it('a path in no area is refused, not guessed', () => {
    expect(roleForRequest(all('full'), 'GET', '/something-new')).toEqual({ unmapped: true });
  });

  it('pages: the longest prefix decides, and the firm pages are never a custom role\'s', () => {
    expect(pagePlaceOf('/reports/reconciliation/abc')).toEqual({ kind: 'area', area: 'banking' });
    expect(pagePlaceOf('/reports/pnl')).toEqual({ kind: 'area', area: 'reports' });
    expect(pagePlaceOf('/setup/coa')).toEqual({ kind: 'area', area: 'accounting' });
    expect(pagePlaceOf('/setup/company-settings')).toEqual({ kind: 'area', area: 'company' });
    expect(pagePlaceOf('/')).toEqual({ kind: 'any' });
    expect(roleForPage(all('full'), '/setup/users')).toBeNull();
    expect(roleForPage({ ...all('view'), payroll: 'none' } as Permissions, '/payroll/employees')).toBeNull();
    expect(roleForPage({ ...all('view'), payroll: 'post' } as Permissions, '/payroll/pay-runs/new')).toBe('accountant');
  });

  it('a stored role missing an area reads it as No access', () => {
    expect(normalizePermissions({ sales: 'post', bogus: 'full' })).toEqual({ ...all('none'), sales: 'post' });
    expect(highestLevel({ ...all('none'), reports: 'view' } as Permissions)).toBe('view');
  });

  it('a role is named, every area is given, and a built-in name is refused', () => {
    expect(customRoleCreateSchema.safeParse({ name: 'Bookkeeper', permissions: all('enter') }).success).toBe(true);
    expect(customRoleCreateSchema.safeParse({ name: 'Bookkeeper', permissions: { sales: 'enter' } }).success).toBe(false);
    expect(customRoleCreateSchema.safeParse({ name: 'Accountant', permissions: all('enter') }).success).toBe(false);
  });
});
