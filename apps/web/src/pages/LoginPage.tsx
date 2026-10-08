import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/auth/useAuth';

type ApiError = { response?: { data?: { error?: { code?: string; message?: string } } } };

export default function LoginPage() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  // Shown once the password is accepted for a login that has the second step on.
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      await login(email, password, needsCode ? code.trim() : undefined);
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
    <div className="min-h-screen grid place-items-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader><CardTitle>Sign in</CardTitle></CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" value={email} onChange={e => { setEmail(e.target.value); setNeedsCode(false); }} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
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
            <Button type="submit" className="w-full" disabled={busy || (needsCode && code.length !== 6)}>{busy ? 'Signing in…' : 'Sign in'}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
