import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AuthPageShell } from '@/components/auth/AuthPageShell';
import { useAuth } from '@/auth/useAuth';
import { clearSignedOutNotice, readSignedOutNotice } from '@/lib/idleSession';
import { getRememberedEmail, rememberEmail, forgetEmail } from '@/lib/rememberedEmail';

type ApiError = { response?: { data?: { error?: { code?: string; message?: string } } } };

export default function LoginPage() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [remembered] = useState(getRememberedEmail);
  const [email, setEmail] = useState(remembered ?? '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  // Shown once the password is accepted for a login that has the second step on.
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Why the browser was signed out (left alone, or the session ended), or a
  // reset-password success notice: said once, from the same slot.
  const [notice] = useState(readSignedOutNotice);
  useEffect(clearSignedOutNotice, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      await login(email, password, needsCode ? code.trim() : undefined);
      rememberEmail(email);
      nav('/', { replace: true });
    } catch (e: unknown) {
      const error = (e as ApiError | undefined)?.response?.data?.error;
      if (error?.code === 'TWO_STEP_REQUIRED') {
        // Not a failure: the password was right, and now the code is asked for.
        setNeedsCode(true);
        setCode('');
      } else {
        setErr(error?.message ?? 'Login failed');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthPageShell>
      <CardHeader>
        <CardTitle className="text-left text-2xl font-semibold">Sign in</CardTitle>
      </CardHeader>
      <CardContent>
        {notice && <p className="mb-4 rounded-md bg-muted p-3 text-sm text-muted-foreground">{notice}</p>}
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="email" value={email} onChange={e => { setEmail(e.target.value); setNeedsCode(false); }} required />
            {remembered && email === remembered && (
              <button
                type="button"
                className="text-xs text-link hover:underline"
                onClick={() => { forgetEmail(); setEmail(''); }}
              >
                Not you? Sign in with a different account
              </button>
            )}
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link to="/forgot-password" className="text-sm text-link hover:underline">Forgot password?</Link>
            </div>
            <div className="relative">
              <Input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" className="pr-10" value={password} onChange={e => { setPassword(e.target.value); setNeedsCode(false); }} required />
              <button
                type="button"
                onClick={() => setShowPassword(s => !s)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          {needsCode && (
            <div className="space-y-2">
              <Label htmlFor="code">Code from your authenticator app</Label>
              <Input
                id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus
                className="font-mono tracking-widest" placeholder="6 digits"
                value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} required
              />
              <p className="text-xs text-muted-foreground">Lost the phone it is on? A firm admin can turn the second step off for you.</p>
            </div>
          )}
          {err && <p className="text-sm text-destructive">{err}</p>}
          <Button type="submit" className="h-11 w-full rounded-lg font-medium" disabled={busy || (needsCode && code.length !== 6)}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
          <p className="text-center text-sm text-muted-foreground">Don't have an account? Contact your administrator</p>
        </form>
      </CardContent>
    </AuthPageShell>
  );
}
