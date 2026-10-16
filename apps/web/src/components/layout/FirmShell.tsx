import { useEffect } from 'react';
import { Link, Navigate, NavLink, Outlet } from 'react-router-dom';
import { Building2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/auth/useAuth';
import { roleLabel } from '@/lib/roleAccess';
import { setExportCompany } from '@/lib/reportExport';
import { SidebarBrand } from './Sidebar';

const FIRM_HOME = '/firm';

// The firm's own view, with no client selected (Faizan's item 68), as in
// QuickBooks Accountant: its own short sidebar, and a top bar that names no
// company. Picking a client opens that client's books in the usual AppShell.
// Firm-wide, so it reads the login's firm role, not a role given for one company;
// the firm overview it shows is a firm admin's (GET /firm-overview).
export function FirmShell() {
  const { user, logout } = useAuth();

  // Nothing printed or exported from here is headed with a client's name.
  useEffect(() => { setExportCompany(''); }, []);
  useEffect(() => { document.title = 'All clients - Accounting App'; }, []);

  if (user && user.role !== 'firm_admin') return <Navigate to="/" replace />;

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground print:block print:h-auto print:overflow-visible">
      <aside className="hidden h-full w-64 shrink-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground lg:flex print:hidden">
        <SidebarBrand />
        <nav className="flex-1 space-y-1 p-3">
          <NavLink
            to={FIRM_HOME}
            end
            className={({ isActive }) => `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium ${isActive ? 'bg-sidebar-hover text-white' : 'hover:bg-sidebar-hover'}`}
          >
            <Users className="h-4 w-4" /> All clients
          </NavLink>
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden print:block print:overflow-visible">
        <header className="relative z-30 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-card/80 px-4 backdrop-blur print:hidden">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            {/* Below lg there is no sidebar, so the way back here is in the bar. */}
            <Link to={FIRM_HOME} className="font-display text-lg tracking-tight lg:hidden">Accounting</Link>
            <span className="inline-flex h-9 items-center gap-2 rounded-md border border-dashed border-input px-3 text-muted-foreground">
              <Building2 className="h-4 w-4 shrink-0" />
              <span className="font-medium text-foreground">All clients</span>
              <span className="hidden sm:inline">· no client selected</span>
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 text-sm">
              <Link to="/account" title="My account" className="font-medium text-foreground hover:underline">{user?.full_name ?? ''}</Link>
              {user && (
                <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                  {roleLabel(user.role)}
                </span>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={logout}>Sign out</Button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto bg-page p-4 lg:p-8 print:overflow-visible print:bg-background print:p-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
