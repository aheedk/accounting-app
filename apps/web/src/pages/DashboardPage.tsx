import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/auth/useAuth';

export default function DashboardPage() {
  const { user, businesses } = useAuth();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <Card>
        <CardHeader><CardTitle>Welcome</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Signed in as {user?.email}. Role: {user?.role}. You have access to {businesses.length} business(es).
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            This is Slice 1 Foundation — Ledger and AR features land in subsequent plans.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
