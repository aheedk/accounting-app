import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './useAuth';
import { IdleSignOut } from './IdleSignOut';
import { LoadingIndicator } from '@/components/ui/LoadingIndicator';
import AccountSetupPage from '@/pages/AccountSetupPage';

export function ProtectedRoute() {
  const { status, user } = useAuth();
  if (status === 'loading') return <LoadingIndicator className="min-h-screen" />;
  if (status === 'anonymous') return <Navigate to="/login" replace />;
  return (
    <>
      <IdleSignOut />
      {/* A login with steps left (its own password, the second step) sees only those. */}
      {user?.setup_required?.length ? <AccountSetupPage /> : <Outlet />}
    </>
  );
}
