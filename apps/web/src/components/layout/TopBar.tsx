import { Button } from '@/components/ui/button';
import { useAuth } from '@/auth/useAuth';

export function TopBar() {
  const { user, businesses, logout } = useAuth();
  return (
    <header className="h-14 shrink-0 border-b bg-card flex items-center justify-between px-4">
      <div className="text-sm text-muted-foreground">
        {businesses.length > 0 ? `${businesses.length} business${businesses.length === 1 ? '' : 'es'}` : 'No business access'}
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm">{user?.full_name ?? ''}</span>
        <Button variant="outline" size="sm" onClick={logout}>Sign out</Button>
      </div>
    </header>
  );
}
