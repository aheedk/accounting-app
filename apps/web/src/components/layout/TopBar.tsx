import { Button } from '@/components/ui/button';
import { useAuth } from '@/auth/useAuth';
import { useActiveBusinessId } from '@/lib/business';

export function TopBar() {
  const { user, businesses, logout } = useAuth();
  const [active, setActive] = useActiveBusinessId();
  return (
    <header className="h-14 shrink-0 border-b bg-card flex items-center justify-between px-4">
      <div className="flex items-center gap-3">
        {businesses.length > 0 ? (
          <select
            value={active ?? ''}
            onChange={e => setActive(e.target.value)}
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            {businesses.map(b => (<option key={b.id} value={b.id}>{b.name}</option>))}
          </select>
        ) : (
          <span className="text-sm text-muted-foreground">No business access</span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm">{user?.full_name ?? ''} ({user?.role})</span>
        <Button variant="outline" size="sm" onClick={logout}>Sign out</Button>
      </div>
    </header>
  );
}
