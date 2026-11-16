import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AuthPageShell } from '@/components/auth/AuthPageShell';
import { api } from '@/lib/apiClient';
import { useAuth } from '@/auth/useAuth';
import { rememberEmail } from '@/lib/rememberedEmail';
import { pickErr } from '@/lib/apiErrors';

type Lookup = { email: string; full_name: string; firm_name: string };

export default function AcceptInvitationPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { acceptInvitation } = useAuth();
  const nav = useNavigate();

  const [state, setState] = useState<'checking' | 'valid' | 'invalid'>('checking');
  const [invalidMessage, setInvalidMessage] = useState('');
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) { setState('invalid'); setInvalidMessage('This invitation link is missing its token.'); return; }
    api.get<Lookup>('/auth/validate-invitation', { params: { token } })
      .then(r => { setLookup(r.data); setFullName(r.data.full_name); setState('valid'); })
      .catch((e: unknown) => { setState('invalid'); setInvalidMessage(pickErr(e)); });
  }, [token]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (password !== confirm) { setErr('The passwords do not match.'); return; }
    setBusy(true);
    try {
      await acceptInvitation(token, password, fullName.trim() || undefined);
      if (lookup) rememberEmail(lookup.email);
      nav('/', { replace: true });
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthPageShell>
      <CardHeader>
        <CardTitle className="text-left text-2xl font-semibold">Set up your account</CardTitle>
      </CardHeader>
      <CardContent>
        {state === 'checking' && <p className="text-sm text-muted-foreground">Checking your invitation…</p>}
        {state === 'invalid' && (
          <div className="space-y-4">
            <p className="text-sm text-destructive">{invalidMessage}</p>
            <p className="text-sm text-muted-foreground">Contact your administrator for a new invitation.</p>
            <Link to="/login" className="text-sm text-link hover:underline">Back to sign in</Link>
          </div>
        )}
        {state === 'valid' && lookup && (
          <form className="space-y-4" onSubmit={onSubmit}>
            <p className="text-sm text-muted-foreground">You've been invited to join {lookup.firm_name} on Accmatica.</p>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={lookup.email} readOnly disabled className="bg-muted" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="full_name">Full name</Label>
              <Input id="full_name" value={fullName} onChange={e => setFullName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input id="password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" className="pr-10"
                  value={password} onChange={e => setPassword(e.target.value)} required />
                <button type="button" onClick={() => setShowPassword(s => !s)} tabIndex={-1}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}>
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">At least 10 characters. Avoid common words, keyboard patterns, or your name or email.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">Confirm password</Label>
              <Input id="confirm" type={showPassword ? 'text' : 'password'} autoComplete="new-password"
                value={confirm} onChange={e => setConfirm(e.target.value)} required />
            </div>
            {err && <p className="text-sm text-destructive">{err}</p>}
            <Button type="submit" className="h-11 w-full rounded-lg font-medium" disabled={busy}>
              {busy ? 'Creating account…' : 'Create account'}
            </Button>
          </form>
        )}
      </CardContent>
    </AuthPageShell>
  );
}
