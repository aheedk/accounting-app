import { hasMinRole, pagePlaceOf, roleForPage, roleForRequest, ROLE_LABELS, AREA_INFO, type Role } from '@accounting/shared';
import { useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/auth/useAuth';
import type { CustomRole } from '@/auth/AuthContext';
import { useActiveBusinessId } from '@/lib/business';

/**
 * What the signed-in login has on the company that is open: a built-in role, or
 * one of the firm's own (docs/specs/2026-11-09-custom-roles-design.md). A role
 * given for one company (Setup → Users) wins over the login's own, the same rule
 * the API applies.
 */
export type Access =
  | { kind: 'builtin'; role: Role }
  | { kind: 'custom'; role: CustomRole };

export function useAccess(): Access | null {
  const { user, businesses } = useAuth();
  const [activeId] = useActiveBusinessId();
  if (!user) return null;
  const business = businesses.find(b => b.id === activeId);
  if (business?.custom_role) return { kind: 'custom', role: business.custom_role };
  if (business?.role_override) return { kind: 'builtin', role: business.role_override };
  if (user.custom_role) return { kind: 'custom', role: user.custom_role };
  return { kind: 'builtin', role: user.role };
}

/**
 * The built-in role the login acts as on the page at `pathname`. For a custom
 * role that is the role of its level in the page's area, so every page that
 * asks `useCan()` or `roleAtLeast()` keeps working; null where it has no access.
 */
export function roleOnPage(access: Access | null, pathname: string): Role | null {
  if (!access) return null;
  return access.kind === 'builtin' ? access.role : roleForPage(access.role.permissions, pathname);
}

/** The signed-in login's role on the company that is open, on the page that is open. */
export function useEffectiveRole(): Role | null {
  const access = useAccess();
  const { pathname } = useLocation();
  return roleOnPage(access, pathname);
}

/** `roleOnPage` for any page, for a menu or a link that leads elsewhere. */
export function useRoleFor(): (pathname: string) => Role | null {
  const access = useAccess();
  return useCallback((pathname: string) => roleOnPage(access, pathname), [access]);
}

/** The name of the login's role on the open company: "Accountant", or a custom role's own name. */
export function useRoleName(): string {
  const access = useAccess();
  if (!access) return '';
  return access.kind === 'custom' ? access.role.name : ROLE_LABELS[access.role];
}

/** Why a page is closed to a custom role, naming the area it lacks; null when it is not a custom role's area. */
export function customRoleRefusal(access: Access | null, pathname: string): string | null {
  if (access?.kind !== 'custom') return null;
  const place = pagePlaceOf(pathname);
  if (place.kind !== 'area') return 'This page is for a firm admin.';
  return `Your role, ${access.role.name}, has no access to ${AREA_INFO[place.area].label}. A firm admin can change it on Setup → Roles.`;
}

/** Whether the AI chat is open to this login: it writes, and reads sales, purchases, banking and the ledger. */
export function useCanChat(): boolean {
  const access = useAccess();
  if (!access) return false;
  if (access.kind === 'builtin') return access.role !== 'client' && access.role !== 'viewer';
  const decided = roleForRequest(access.role.permissions, 'POST', '/chat');
  return 'role' in decided && decided.role !== 'viewer';
}

// A client login sees its own invoices and the financial reports, and nothing
// else. Keep in step with apps/api/src/lib/clientAccess.ts, which enforces it.
const CLIENT_PAGES = [
  '/reports/pnl',
  '/reports/balance-sheet',
  '/reports/statement-of-cash-flows',
  '/reports/trial-balance',
  '/reports/aging',
  '/reports/ap-aging',
  '/reports/customer-statement',
  '/messages',
  '/documents/send',
];

// Sending documents in is the client's page. The firm uploads from the AI inbox.
const CLIENT_ONLY_PAGES = ['/documents/send'];

// Pages where everything on them is for a firm admin. Hidden from the others
// rather than opened and left to fail.
const FIRM_ADMIN_PAGES = ['/firm', '/setup/users', '/setup/roles', '/clients/new', '/accounting/client-overview', '/payroll/employees/new'];

// Pages for an accountant and up. The activity log shows every record before and
// after each change; the rest are forms the API takes only from an accountant, so
// staff are not handed a form they cannot save.
const ACCOUNTANT_PAGES = [
  '/setup/activity',
  '/setup/quickbooks-import',
  '/journal/new',
  '/accounting/transfers/new',
  '/credit-memos/new',
  '/ap/vendor-credits/new',
  '/ap/pay-bills',
  '/payroll/pay-runs/new',
];

const under = (pathname: string, page: string) => pathname === page || pathname.startsWith(`${page}/`);

/**
 * Whether this role has any business on the page at `pathname`. `access.payroll`
 * is false for a login a firm admin has switched payroll off for.
 */
export function canOpenPage(role: Role | null, pathname: string, access: { payroll: boolean } = { payroll: true }): boolean {
  if (!role) return false;
  if (!access.payroll && under(pathname, '/payroll')) return false;
  if (role === 'client') {
    // The dashboard, and the person's own login (password, second step, sessions).
    if (pathname === '/' || pathname === '/account') return true;
    // The list and one invoice or bill, but not the forms that write a new one.
    if (pathname === '/invoices' || (pathname.startsWith('/invoices/') && pathname !== '/invoices/new')) return true;
    if (pathname === '/ap/bills' || (pathname.startsWith('/ap/bills/') && pathname !== '/ap/bills/new')) return true;
    return CLIENT_PAGES.some(page => under(pathname, page));
  }
  if (CLIENT_ONLY_PAGES.some(page => under(pathname, page))) return false;
  // A view-only login opens every page staff can, except the forms that add something.
  if (role === 'viewer' && /\/(new|import)(\/|$)/.test(pathname)) return false;
  if (FIRM_ADMIN_PAGES.some(page => under(pathname, page))) return role === 'firm_admin';
  if (ACCOUNTANT_PAGES.some(page => under(pathname, page))) return hasMinRole(role, 'accountant');
  return true;
}

/** True when the role is at least `min`; false while the user is still loading. */
export function roleAtLeast(role: Role | null, min: Role): boolean {
  return role !== null && hasMinRole(role, min);
}

/** The role as a person reads it: "View only", not "viewer". For a custom role, `useRoleName()`. */
export function roleLabel(role: Role | null | undefined): string {
  return role ? ROLE_LABELS[role] : '';
}

/**
 * `canOpenPage` for the signed-in user on the open company, with their payroll
 * switch. What the sidebar, + New, search and the page shell all ask.
 */
export function useCanOpen(): (pathname: string) => boolean {
  const access = useAccess();
  const { user } = useAuth();
  // Absent on a session from before the switch existed: that login keeps payroll until it next signs in.
  const payroll = user?.payroll_access !== false;
  // Each page is asked about with the role the login has on that page: for a
  // custom role, the level of the page's own area (null: none, or a firm page).
  return useCallback((pathname: string) => canOpenPage(roleOnPage(access, pathname), pathname, { payroll }), [access, payroll]);
}

/** What the signed-in login may do on the open company, for showing or hiding a button. */
export function useCan(): { staff: boolean; accountant: boolean; admin: boolean } {
  const role = useEffectiveRole();
  return { staff: roleAtLeast(role, 'staff'), accountant: roleAtLeast(role, 'accountant'), admin: role === 'firm_admin' };
}

/**
 * Props that take an element off the page when `allowed` is false, to spread on
 * a button or a form: `<Button {...hideUnless(can.accountant)} onClick={post}>`.
 * An inline style, because it wins over the display classes buttons carry.
 */
export function hideUnless(allowed: boolean): { style?: { display: 'none' } } {
  return allowed ? {} : { style: { display: 'none' } };
}
