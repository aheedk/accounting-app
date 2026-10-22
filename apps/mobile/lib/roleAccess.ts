import { useCallback } from 'react';
import { hasMinRole, type Role } from '@accounting/shared';
import { useAuth } from '../hooks/useAuth';

// Ported from apps/web/src/lib/roleAccess.ts's canOpenPage/useCanOpen — same
// role semantics (client allow-list, viewer can't open a "new" form), but
// keyed to this app's own real routes rather than web's, since most of web's
// pages don't exist here yet. Keep in step with apps/api/src/lib/clientAccess.ts,
// which enforces the same rule server-side.

/** The signed-in user's role on the open business; a per-business override wins. */
export function useEffectiveRole(): Role | null {
  const { user, businesses, activeBusinessId } = useAuth();
  if (!user) return null;
  return (businesses.find(b => b.id === activeBusinessId)?.role_override ?? user.role) as Role;
}

// A client login sees its own invoices and the financial reports, nothing else.
const CLIENT_PAGES = ['/pnl', '/balance-sheet', '/trial-balance', '/cash-flow', '/ar-aging', '/ap-aging', '/customer-statement', '/messages', '/send-documents'];

const under = (pathname: string, page: string) => pathname === page || pathname.startsWith(`${page}/`);

/** Whether this role has any business opening `pathname` in this app. */
export function canOpenPage(role: Role | null, pathname: string): boolean {
  if (!role) return false;
  if (role === 'client') {
    if (pathname === '/(tabs)') return true;
    if (pathname === '/invoices' || (pathname.startsWith('/invoices/') && pathname !== '/invoices/new')) return true;
    if (pathname === '/bills' || (pathname.startsWith('/bill/') && pathname !== '/bill/new')) return true;
    return CLIENT_PAGES.some(page => under(pathname, page));
  }
  // A view-only login opens every page staff can, except the forms that add something.
  if (role === 'viewer' && /\/new(\/|$)/.test(pathname)) return false;
  return true;
}

/** `canOpenPage` for the signed-in user on the open business — what the drawer and Create tab ask. */
export function useCanOpen(): (pathname: string) => boolean {
  const role = useEffectiveRole();
  return useCallback((pathname: string) => canOpenPage(role, pathname), [role]);
}

export function roleAtLeast(role: Role | null, min: Role): boolean {
  return role !== null && hasMinRole(role, min);
}
