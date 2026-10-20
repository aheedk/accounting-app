import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './useAuth';
import { LoadingIndicator } from '@/components/ui/LoadingIndicator';

export function ProtectedRoute() {
  const { status } = useAuth();
  if (status === 'loading') return <LoadingIndicator className="min-h-screen" />;
  if (status === 'anonymous') return <Navigate to="/login" replace />;
  return <Outlet />;
}
