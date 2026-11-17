import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AuthPageShell } from '@/components/auth/AuthPageShell';
import { useAuth } from '@/auth/useAuth';

// Where a Google/Microsoft sign-in's server-side callback redirects once it
// has already set the refresh cookie — this page's only job is to pick up
// the session the cookie now carries (the same renew() an idle-but-still-
// signed-in tab uses) and continue in. No token ever appears in this page's
// URL. If the cookie turns out not to be valid after all, renew() leaves the
// app in its normal signed-out state and ProtectedRoute sends this along to
// /login on its own — nothing special to handle here.
export default function OAuthCompletePage() {
  const { renew } = useAuth();
  const nav = useNavigate();

  useEffect(() => {
    void renew().finally(() => nav('/', { replace: true }));
  }, [renew, nav]);

  return (
    <AuthPageShell>
      <CardHeader>
        <CardTitle className="text-left text-2xl font-semibold">Signing you in…</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">One moment.</p>
      </CardContent>
    </AuthPageShell>
  );
}
