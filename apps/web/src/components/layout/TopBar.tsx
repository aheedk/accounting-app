import { Menu } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/auth/useAuth';
import { BusinessSwitcher } from '@/components/layout/BusinessSwitcher';
import { GlobalSearch } from '@/components/layout/GlobalSearch';
import { roleLabel, useEffectiveRole } from '@/lib/roleAccess';

export function TopBar({ onMenuClick }: { onMenuClick: () => void }) {
  const { user, logout } = useAuth();
  // The role on the company that is open; a role given for one company differs from the firm-wide one.
  const role = useEffectiveRole();
  return (
    // relative z-30: backdrop-blur creates a stacking context at z-auto, which
    // let positioned page content (toolbars, inputs) paint OVER the header's
    // dropdowns (company switcher, menus). Fixed inset-0 z-50 overlays still
    // cover the header.
    <header className="relative z-30 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-card/80 px-4 backdrop-blur">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Open navigation menu"
          className="-ml-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <BusinessSwitcher />
      </div>

      <div className="flex flex-1 justify-center">
        <GlobalSearch />
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <div className="hidden sm:flex items-center gap-2 text-sm">
          {/* The name opens the person's own login: password, second step, sessions. */}
          <Link to="/account" title="My account" className="font-medium text-foreground hover:underline">{user?.full_name ?? ''}</Link>
          {role && (
            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
              {roleLabel(role)}
            </span>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={logout}>Sign out</Button>
      </div>
    </header>
  );
}
