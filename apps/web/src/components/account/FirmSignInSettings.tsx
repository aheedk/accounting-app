import { useEffect, useState } from 'react';
import { api } from '@/lib/apiClient';
import { pickErr } from '@/lib/apiErrors';
import { flashMessage } from '@/lib/flash';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { AppSelect } from '@/components/ui/select';

type Settings = { require_two_step: boolean; idle_sign_out_minutes: number };

const IDLE_CHOICES: Array<{ minutes: number; label: string }> = [
  { minutes: 15, label: '15 minutes' },
  { minutes: 30, label: '30 minutes' },
  { minutes: 60, label: '1 hour' },
  { minutes: 120, label: '2 hours' },
  { minutes: 180, label: '3 hours' },
];

// The firm's sign-in settings, on Setup → Users (firm admins only): the second
// step for every login, and how long a browser may be left alone before it is
// signed out. Spec: docs/specs/2026-10-08-accounts-and-roles-design.md.
export function FirmSignInSettings({ withoutTwoStep }: { withoutTwoStep: number }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<Settings>('/me/firm/security')
      .then(r => setSettings(r.data))
      .catch((e: unknown) => setErr(pickErr(e)));
  }, []);

  async function save(patch: Partial<Settings>) {
    setErr(null); setBusy(true);
    try {
      setSettings((await api.patch<Settings>('/me/firm/security', patch)).data);
      flashMessage('Sign-in settings saved.');
    } catch (e: unknown) { setErr(pickErr(e)); }
    finally { setBusy(false); }
  }

  return (
    <Card>
      <CardHeader><CardTitle>Sign-in security</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-sm">
        {settings && (
          <>
            <label className="flex items-start gap-3">
              <input
                type="checkbox" className="mt-1 h-4 w-4" disabled={busy}
                checked={settings.require_two_step}
                onChange={e => void save({ require_two_step: e.target.checked })}
              />
              <span>
                <span className="font-medium">Require the second step for every login</span>
                <span className="block text-muted-foreground">
                  Everyone signs in with a code from an authenticator app as well as their password.
                  Anyone without it set up is asked to set it up at their next sign-in, before anything else.
                  {!settings.require_two_step && withoutTwoStep > 0 && ` ${withoutTwoStep} login${withoutTwoStep === 1 ? ' has' : 's have'} not set it up yet.`}
                </span>
              </span>
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <Label htmlFor="idle-sign-out">Sign out a browser left alone for</Label>
              <AppSelect
                id="idle-sign-out" className="h-9 rounded-md border bg-background px-3 text-sm" disabled={busy}
                value={String(settings.idle_sign_out_minutes)}
                onChange={e => void save({ idle_sign_out_minutes: Number(e.target.value) })}
              >
                {IDLE_CHOICES.map(c => <option key={c.minutes} value={c.minutes}>{c.label}</option>)}
              </AppSelect>
            </div>
            <p className="text-xs text-muted-foreground">
              Whatever is chosen, everyone signs in again 12 hours after they last did. A change reaches people already signed in within 15 minutes.
            </p>
          </>
        )}
        {err && <p className="text-destructive">{err}</p>}
      </CardContent>
    </Card>
  );
}
