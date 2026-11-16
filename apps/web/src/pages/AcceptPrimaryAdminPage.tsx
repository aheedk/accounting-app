import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AuthPageShell } from '@/components/auth/AuthPageShell';
import { api } from '@/lib/apiClient';
import { pickErr } from '@/lib/apiErrors';

type Lookup = { firm_name: string; current_admin_name: string; target_email: string };

// The link a Primary Admin transfer email sends (Setup → Users → Transfer
// Primary Admin). Public: the recipient isn't necessarily signed in here.
// Spec: docs/specs/2026-11-15-user-invitations-and-signin-design.md
export default function AcceptPrimaryAdminPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [state, setState] = useState<'checking' | 'valid' | 'invalid' | 'accepted' | 'declined'>('checking');
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [invalidMessage, setInvalidMessage] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);

  useEffect(() => {
    if (!token) { setState('invalid'); setInvalidMessage('This link is missing its token.'); return; }
    api.get<Lookup>('/auth/validate-primary-admin-transfer', { params: { token } })
      .then(r => { setLookup(r.data); setState('valid'); })
      .catch((e: unknown) => { setState('invalid'); setInvalidMessage(pickErr(e)); });
  }, [token]);

  async function respond(action: 'accept' | 'decline') {
    setErr(null);
    setBusy(action);
    try {
      await api.post(`/auth/${action}-primary-admin`, { token });
      setState(action === 'accept' ? 'accepted' : 'declined');
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <AuthPageShell>
      <CardHeader>
        <CardTitle className="text-left text-2xl font-semibold">Primary Admin transfer</CardTitle>
      </CardHeader>
      <CardContent>
        {state === 'checking' && <p className="text-sm text-muted-foreground">Checking your link…</p>}
        {state === 'invalid' && (
          <div className="space-y-4">
            <p className="text-sm text-destructive">{invalidMessage}</p>
            <Link to="/login" className="text-sm text-link hover:underline">Back to sign in</Link>
          </div>
        )}
        {state === 'valid' && lookup && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              <strong>{lookup.current_admin_name}</strong> wants to make <strong>{lookup.target_email}</strong> the
              Primary Admin of <strong>{lookup.firm_name}</strong> — the firm's one owner, who can't be removed
              except by transferring the role onward. Accepting makes you the Primary Admin immediately;{' '}
              {lookup.current_admin_name} keeps their firm admin access, just not the designation.
            </p>
            {err && <p className="text-sm text-destructive">{err}</p>}
            <div className="flex gap-3">
              <Button className="h-11 flex-1 rounded-lg font-medium" disabled={busy !== null} onClick={() => void respond('accept')}>
                {busy === 'accept' ? 'Accepting…' : 'Accept'}
              </Button>
              <Button variant="outline" className="h-11 flex-1 rounded-lg font-medium" disabled={busy !== null} onClick={() => void respond('decline')}>
                {busy === 'decline' ? 'Declining…' : 'Decline'}
              </Button>
            </div>
          </div>
        )}
        {state === 'accepted' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">You're now the Primary Admin. Sign in to continue.</p>
            <Link to="/login" className="text-sm text-link hover:underline">Go to sign in</Link>
          </div>
        )}
        {state === 'declined' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Declined. Nothing changed.</p>
            <Link to="/login" className="text-sm text-link hover:underline">Back to sign in</Link>
          </div>
        )}
      </CardContent>
    </AuthPageShell>
  );
}
