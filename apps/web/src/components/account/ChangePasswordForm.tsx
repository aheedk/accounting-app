import { useState } from 'react';
import { api } from '@/lib/apiClient';
import { pickErr } from '@/lib/apiErrors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Changing one's own password: on My account, and in the set-up a login with a
// password made by a firm admin goes through before the app opens.

// What a good password is (the API's rules: packages/shared/src/passwords.ts).
const PASSWORD_HINT = 'At least 10 characters. A few unrelated words are easy to remember and hard to guess; common passwords and your own name or email are refused.';

export function ChangePasswordForm({ currentLabel = 'Current password', note, onChanged }: {
  currentLabel?: string;
  /** Said after what a good password is. */
  note?: string;
  onChanged: () => Promise<void> | void;
}) {
  const [password, setPassword] = useState({ current: '', next: '', again: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (password.next !== password.again) { setErr('The two new passwords are not the same.'); return; }
    setBusy(true);
    try {
      await api.post('/auth/password', { current_password: password.current, new_password: password.next });
      setPassword({ current: '', next: '', again: '' });
      await onChanged();
    } catch (e: unknown) { setErr(pickErr(e)); }
    finally { setBusy(false); }
  }

  return (
    <form className="grid gap-3 sm:grid-cols-3" onSubmit={submit}>
      <div>
        <Label htmlFor="current-password">{currentLabel}</Label>
        <Input id="current-password" type="password" autoComplete="current-password" value={password.current} onChange={e => setPassword(p => ({ ...p, current: e.target.value }))} required />
      </div>
      <div>
        <Label htmlFor="new-password">New password</Label>
        <Input id="new-password" type="password" autoComplete="new-password" minLength={10} value={password.next} onChange={e => setPassword(p => ({ ...p, next: e.target.value }))} required />
      </div>
      <div>
        <Label htmlFor="new-password-again">New password again</Label>
        <Input id="new-password-again" type="password" autoComplete="new-password" minLength={10} value={password.again} onChange={e => setPassword(p => ({ ...p, again: e.target.value }))} required />
      </div>
      <p className="text-xs text-muted-foreground sm:col-span-3">{PASSWORD_HINT}{note ? ` ${note}` : ''}</p>
      {err && <p className="text-sm text-destructive sm:col-span-3">{err}</p>}
      <div className="sm:col-span-3"><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</Button></div>
    </form>
  );
}
