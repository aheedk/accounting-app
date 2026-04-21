import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './useAuth';

export function ProtectedRoute() {
  const { status } = useAuth();
  if (status === 'loading') return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (status === 'anonymous') return <Navigate to="/login" replace />;
  return <Outlet />;
}
