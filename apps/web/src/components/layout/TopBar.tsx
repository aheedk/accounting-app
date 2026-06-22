import { Button } from '@/components/ui/button';
import { useAuth } from '@/auth/useAuth';
import { BusinessSwitcher } from '@/components/layout/BusinessSwitcher';
import { GlobalSearch } from '@/components/layout/GlobalSearch';

export function TopBar() {
  const { user, logout } = useAuth();
  return (
    <header className="h-14 shrink-0 border-b border-border bg-card/80 backdrop-blur flex items-center gap-4 px-4">
      <div className="flex shrink-0 items-center">
        <BusinessSwitcher />
      </div>

      <div className="flex flex-1 justify-center">
        <GlobalSearch />
      </div>

      <div className="flex shrink-0 items-center gap-3">
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
