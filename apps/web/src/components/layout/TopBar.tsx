import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/auth/useAuth';
import { BusinessSwitcher } from '@/components/layout/BusinessSwitcher';

export function TopBar({ onMenuClick }: { onMenuClick: () => void }) {
  const { user, logout } = useAuth();
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-card/80 px-4 backdrop-blur">
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
      <div className="flex items-center gap-3">
        <div className="hidden sm:flex items-center gap-2 text-sm">
          <span className="font-medium text-foreground">{user?.full_name ?? ''}</span>
          {user?.role && (
            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
              {user.role}
            </span>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={logout}>Sign out</Button>
      </div>
    </header>
  );
}
