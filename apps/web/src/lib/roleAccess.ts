import { hasMinRole, type Role } from '@accounting/shared';
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

const under = (pathname: string, page: string) => pathname === page || pathname.startsWith(`${page}/`);

/** Whether this role has any business on the page at `pathname`. */
export function canOpenPage(role: Role | null, pathname: string): boolean {
  if (!role) return false;
  if (role === 'client') {
    // The dashboard, and the person's own login (password, second step, sessions).
    if (pathname === '/' || pathname === '/account') return true;
    // The list and one invoice, but not the form that writes a new one.
    if (pathname === '/invoices' || (pathname.startsWith('/invoices/') && pathname !== '/invoices/new')) return true;
    return CLIENT_PAGES.some(page => under(pathname, page));
  }
  if (FIRM_ADMIN_PAGES.some(page => under(pathname, page))) return role === 'firm_admin';
  return true;
}

/** True when the role is at least `min`; false while the user is still loading. */
export function roleAtLeast(role: Role | null, min: Role): boolean {
  return role !== null && hasMinRole(role, min);
}
