import { useState } from 'react';
import { api } from '@/lib/apiClient';
import { pickErr } from '@/lib/apiErrors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Setting up the second step of signing in: on My account, and in the set-up a
// login goes through when its firm requires the second step.
export function TwoStepSetupForm({ onEnabled, canCancel = true }: {
  onEnabled: () => Promise<void> | void;
  canCancel?: boolean;
}) {
  const [setup, setSetup] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(step: () => Promise<void>) {
    setErr(null); setBusy(true);
    try { await step(); }
    catch (e: unknown) { setErr(pickErr(e)); }
    finally { setBusy(false); }
  }
  const begin = () => run(async () => {
    setSetup((await api.post<{ secret: string; otpauth_uri: string }>('/auth/two-step/setup')).data);
    setCode('');
  });
  const confirm = (e: React.FormEvent) => {
    e.preventDefault();
    return run(async () => {
      await api.post('/auth/two-step/confirm', { code });
      setSetup(null);
      await onEnabled();
    });
  };

  return (
    <div className="space-y-3">
      {setup ? (
        <form className="space-y-3" onSubmit={confirm}>
          <ol className="list-decimal space-y-2 pl-5">
            <li>In your authenticator app, add an account and choose to enter a setup key.</li>
            <li>
              Type this key (the account name can be anything, such as your email):
              <div className="mt-1 select-all break-all rounded-md bg-muted p-3 font-mono text-sm tracking-wider">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</div>
              <a className="mt-1 inline-block text-xs text-link hover:underline" href={setup.otpauth_uri}>On this phone? Open it in the app.</a>
            </li>
            <li>
              <Label htmlFor="setup-code">Enter the 6-digit code the app shows</Label>
              <Input id="setup-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="mt-1 w-40 font-mono tracking-widest" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} required />
            </li>
          </ol>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || code.length !== 6}>Turn on</Button>
            {canCancel && <Button type="button" variant="ghost" onClick={() => { setSetup(null); setErr(null); }}>Cancel</Button>}
          </div>
        </form>
      ) : (
        <Button onClick={() => void begin()} disabled={busy}>Set it up</Button>
      )}
      {err && <p className="text-sm text-destructive">{err}</p>}
    </div>
  );
}
