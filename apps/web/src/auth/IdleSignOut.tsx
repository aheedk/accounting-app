import { useEffect, useRef, useState } from 'react';
import { useAuth } from './useAuth';
import { lastRenewedAt, renewSession } from '@/lib/apiClient';
import { idleStep, lastActivity, markSignedOutIdle, noteActivity } from '@/lib/idleSession';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';

const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;
const CHECK_EVERY_MS = 15_000;
const NOTE_AT_MOST_EVERY_MS = 5_000;

// Signs the browser out after the firm's idle limit with nothing done, with a
// warning two minutes before, and keeps the session renewed while the person
// is active. The rules are in lib/idleSession.ts.
export function IdleSignOut() {
  const { user, logout } = useAuth();
  const limitMinutes = user?.idle_sign_out_minutes ?? 60;
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const signingOut = useRef(false);

  useEffect(() => {
    noteActivity();
    let lastNoted = Date.now();
    const onActivity = () => {
      const now = Date.now();
      if (now - lastNoted < NOTE_AT_MOST_EVERY_MS) return;
      lastNoted = now;
      noteActivity(now);
    };
    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, onActivity, { passive: true, capture: true });

    const check = () => {
      if (signingOut.current) return;
      const step = idleStep({ now: Date.now(), lastActivity: lastActivity(), lastRenewed: lastRenewedAt(), limitMinutes });
      if (step.signOut) {
        signingOut.current = true;
        markSignedOutIdle(limitMinutes);
        void logout();
        return;
      }
      setSecondsLeft(step.warn ? step.secondsLeft : null);
      // Not signed out when it fails: another tab may have renewed a moment before.
      if (step.renew) void renewSession({ keepTokenOnFailure: true });
    };
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    // Another tab's activity or sign-out shows here at once, not at the next check.
    window.addEventListener('storage', check);
    return () => {
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, onActivity, { capture: true });
      window.clearInterval(timer);
      window.removeEventListener('storage', check);
    };
  }, [limitMinutes, logout]);

  // The warning counts down by the second; the checks above run less often.
  useEffect(() => {
    if (secondsLeft === null) return;
    const tick = window.setTimeout(() => setSecondsLeft(s => (s === null ? null : Math.max(0, s - 1))), 1000);
    return () => window.clearTimeout(tick);
  }, [secondsLeft]);

  function stay() {
    noteActivity();
    setSecondsLeft(null);
    void renewSession({ keepTokenOnFailure: true });
  }

  const minutes = secondsLeft === null ? 0 : Math.floor(secondsLeft / 60);
  const seconds = secondsLeft === null ? 0 : secondsLeft % 60;
  return (
    <Dialog open={secondsLeft !== null} onOpenChange={open => { if (!open) stay(); }}>
      <DialogContent className="max-w-md">
        <div className="space-y-2 px-6 py-5">
          <DialogTitle>Still there?</DialogTitle>
          <p className="text-sm text-muted-foreground">
            For security, you will be signed out in{' '}
            <span className="font-mono font-medium text-foreground">{minutes}:{String(seconds).padStart(2, '0')}</span>{' '}
            because nothing has been done for a while.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => void logout()}>Sign out</Button>
          <Button onClick={stay}>Stay signed in</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
