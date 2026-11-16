import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AuthPageShell } from '@/components/auth/AuthPageShell';
import { api } from '@/lib/apiClient';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      // The same response whether or not the address has a login — so this
      // page never reveals which emails do (the API already keeps that quiet).
      await api.post('/auth/forgot-password', { email });
    } finally {
      setBusy(false);
      setSent(true);
    }
  }

  return (
    <AuthPageShell>
      <CardHeader>
        <CardTitle className="text-left text-2xl font-semibold">Reset your password</CardTitle>
      </CardHeader>
      <CardContent>
        {sent ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              If <strong>{email}</strong> has an account, we've sent a link to reset its password.
            </p>
            <Link to="/login" className="text-sm text-link hover:underline">Back to sign in</Link>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={onSubmit}>
            <p className="text-sm text-muted-foreground">Enter your email and we'll send you a link to reset your password.</p>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" autoFocus value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <Button type="submit" className="h-11 w-full rounded-lg font-medium" disabled={busy}>
              {busy ? 'Sending…' : 'Send reset link'}
            </Button>
            <Link to="/login" className="block text-center text-sm text-link hover:underline">Back to sign in</Link>
          </form>
        )}
      </CardContent>
    </AuthPageShell>
  );
}
