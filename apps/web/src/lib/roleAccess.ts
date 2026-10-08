import { hasMinRole, ROLE_LABELS, type Role } from '@accounting/shared';
import { useCallback } from 'react';
import { useAuth } from '@/auth/useAuth';
import { useActiveBusinessId } from '@/lib/business';

/**
 * The signed-in user's role on the company that is open. A role given for one
 * company (Setup → Users) wins over the user's role in the firm, the same rule
 * the API applies.
 */
export function useEffectiveRole(): Role | null {
  const { user, businesses } = useAuth();
  const [activeId] = useActiveBusinessId();
  if (!user) return null;
  return businesses.find(b => b.id === activeId)?.role_override ?? user.role;
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
];

// Pages where everything on them is for a firm admin. Hidden from the others
// rather than opened and left to fail.
const FIRM_ADMIN_PAGES = ['/setup/users', '/clients/new', '/accounting/client-overview'];

// Pages for an accountant and up. The activity log shows every record before and after each change.
const ACCOUNTANT_PAGES = ['/setup/activity'];

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
    // The list and one invoice, but not the form that writes a new one.
    if (pathname === '/invoices' || (pathname.startsWith('/invoices/') && pathname !== '/invoices/new')) return true;
    return CLIENT_PAGES.some(page => under(pathname, page));
  }
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

/** The role as a person reads it: "View only", not "viewer". */
export function roleLabel(role: Role | null | undefined): string {
  return role ? ROLE_LABELS[role] : '';
}

/**
 * `canOpenPage` for the signed-in user on the open company, with their payroll
 * switch. What the sidebar, + New, search and the page shell all ask.
 */
export function useCanOpen(): (pathname: string) => boolean {
  const role = useEffectiveRole();
  const { user } = useAuth();
  // Absent on a session from before the switch existed: that login keeps payroll until it next signs in.
  const payroll = user?.payroll_access !== false;
  return useCallback((pathname: string) => canOpenPage(role, pathname, { payroll }), [role, payroll]);
}
