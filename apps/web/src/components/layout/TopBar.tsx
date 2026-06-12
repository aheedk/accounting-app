import { Button } from '@/components/ui/button';
import { useAuth } from '@/auth/useAuth';
import { useActiveBusinessId } from '@/lib/business';

export function TopBar() {
  const { user, businesses, logout } = useAuth();
  const [active, setActive] = useActiveBusinessId();
  return (
    <header className="h-14 shrink-0 border-b border-border bg-card/80 backdrop-blur flex items-center justify-between px-4">
      <div className="flex items-center gap-3">
        {businesses.length > 0 ? (
          <select
            value={active ?? ''}
            onChange={e => setActive(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 hover:border-primary/40"
          >
            {businesses.map(b => (<option key={b.id} value={b.id}>{b.name}</option>))}
          </select>
        ) : (
          <span className="text-sm text-muted-foreground">No business access</span>
        )}
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
