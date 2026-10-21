import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/apiClient';
import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { pickErr } from '@/lib/apiErrors';
import { fmtDateTime } from '@/lib/dates';
import { flashMessage } from '@/lib/flash';
import { roleLabel } from '@/lib/roleAccess';
import { describeBrowser } from '@/lib/browserName';
import { ChangePasswordForm } from '@/components/account/ChangePasswordForm';
import { TwoStepSetupForm } from '@/components/account/TwoStepSetupForm';

type Session = { id: string; started_at: string; last_active_at: string; user_agent: string | null; ip_address: string | null; current: boolean };
type Account = { email: string; two_step_enabled: boolean; two_step_required: boolean; sessions: Session[] };

// The signed-in person's own login: password, the second step of signing in,
// and where they are signed in. Every role has this page.
export default function AccountPage() {
  const { user } = useAuth();
  const [account, setAccount] = useState<Account | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try { setAccount((await api.get<Account>('/auth/account')).data); }
    catch (e: unknown) { setErr(pickErr(e)); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  // ── Second step
  const [offPassword, setOffPassword] = useState('');
  const [turningOff, setTurningOff] = useState(false);
  const [stepErr, setStepErr] = useState<string | null>(null);
  const [stepBusy, setStepBusy] = useState(false);

  async function stepAction(run: () => Promise<void>) {
    setStepErr(null); setStepBusy(true);
    try { await run(); await reload(); }
    catch (e: unknown) { setStepErr(pickErr(e)); }
    finally { setStepBusy(false); }
  }
  const turnOff = (e: React.FormEvent) => {
    e.preventDefault();
    return stepAction(async () => {
      await api.post('/auth/two-step/off', { password: offPassword });
      setOffPassword(''); setTurningOff(false);
      flashMessage('The second step is off.');
    });
  };

  // ── Sessions
  const [sessionErr, setSessionErr] = useState<string | null>(null);
  async function endSession(id: string) {
    setSessionErr(null);
    try { await api.delete(`/auth/sessions/${id}`); await reload(); }
    catch (e: unknown) { setSessionErr(pickErr(e)); }
  }
  async function signOutOthers() {
    setSessionErr(null);
    try {
      const r = await api.post<{ ended: number }>('/auth/sessions/sign-out-others');
      flashMessage(r.data.ended === 0 ? 'No other browser was signed in.' : `Signed out of ${r.data.ended} other browser${r.data.ended === 1 ? '' : 's'}.`, 4000);
      await reload();
    } catch (e: unknown) { setSessionErr(pickErr(e)); }
  }

  const others = account?.sessions.filter(s => !s.current).length ?? 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">My account</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {user?.full_name} · {user?.email}{user?.role ? ` · ${roleLabel(user.role)}` : ''}
        </p>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}

      <Card>
        <CardHeader><CardTitle>Password</CardTitle></CardHeader>
        <CardContent>
          <ChangePasswordForm
            note="Changing it signs you out of every other browser."
            onChanged={async () => {
              flashMessage('Password changed. Other browsers were signed out.', 4000);
              await reload();
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Second step when signing in</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            After your password, the app asks for a 6-digit code from an authenticator app on your phone
            (Google Authenticator, Microsoft Authenticator, 1Password and others). A stolen password alone
            then gets nobody in.
          </p>
          {account?.two_step_enabled ? (
            <>
              <p><span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">On</span></p>
              {account.two_step_required ? (
                // Moving it to a new phone: a firm admin resets it, then it is set up again at sign-in.
                <p className="text-muted-foreground">Your firm requires the second step. New phone? Ask a firm admin to reset it, then set it up again when you sign in.</p>
              ) : turningOff ? (
                <form className="flex flex-wrap items-end gap-2" onSubmit={turnOff}>
                  <div>
                    <Label htmlFor="off-password">Your password</Label>
                    <Input id="off-password" type="password" autoComplete="current-password" value={offPassword} onChange={e => setOffPassword(e.target.value)} required />
                  </div>
                  <Button type="submit" variant="outline" disabled={stepBusy}>Turn it off</Button>
                  <Button type="button" variant="ghost" onClick={() => { setTurningOff(false); setStepErr(null); }}>Cancel</Button>
                </form>
              ) : (
                <Button variant="outline" onClick={() => setTurningOff(true)}>Turn off</Button>
              )}
            </>
          ) : account ? (
            <TwoStepSetupForm onEnabled={async () => { flashMessage('The second step is on.'); await reload(); }} />
          ) : null}
          {stepErr && <p className="text-sm text-destructive">{stepErr}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Where you are signed in</CardTitle>
          {others > 0 && <Button variant="outline" size="sm" onClick={() => void signOutOthers()}>Sign out everywhere else</Button>}
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th className="p-3 text-left">Browser</th>
                <th className="p-3 text-left">Signed in</th>
                <th className="p-3 text-left">Last active</th>
                <th className="p-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {(account?.sessions ?? []).map(s => (
                <tr key={s.id} className="border-b last:border-b-0">
                  <td className="p-3">
                    {describeBrowser(s.user_agent)}
                    {s.current && <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">This browser</span>}
                    {s.ip_address && <div className="text-xs text-muted-foreground">{s.ip_address}</div>}
                  </td>
                  <td className="p-3 whitespace-nowrap">{fmtDateTime(s.started_at)}</td>
                  <td className="p-3 whitespace-nowrap">{fmtDateTime(s.last_active_at)}</td>
                  <td className="p-3 text-right">
                    {!s.current && <Button size="sm" variant="ghost" className="h-auto p-0 font-normal text-link hover:text-link" onClick={() => void endSession(s.id)}>Sign out</Button>}
                  </td>
                </tr>
              ))}
              {account && account.sessions.length === 0 && (
                <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">No sessions.</td></tr>
              )}
            </tbody>
          </table>
          {sessionErr && <p className="p-3 text-sm text-destructive">{sessionErr}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
