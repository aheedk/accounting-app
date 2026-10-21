// Signing a browser out after the firm's idle limit (security review 2026-10-21).
// The API ends a session whose sign-in key has not been renewed within the
// limit (services/auth/authService.ts on the API). In use, the app renews it
// every few minutes, so the API's limit is only reached when nobody is there;
// left alone, the app signs out itself, with a warning first, as QuickBooks does.

const ACTIVITY_KEY = 'acct_last_activity';
export const IDLE_WARNING_MS = 2 * 60_000;

let lastActivityHere = Date.now();

/** Notes that the person did something. Shared across tabs, so one busy tab keeps the others signed in. */
export function noteActivity(now = Date.now()): void {
  lastActivityHere = now;
  try { localStorage.setItem(ACTIVITY_KEY, String(now)); } catch { /* private window: this tab alone counts */ }
}

/** The last time the person did something in any tab of the app, epoch ms. */
export function lastActivity(): number {
  try {
    const shared = Number(localStorage.getItem(ACTIVITY_KEY) ?? 0);
    return Math.max(lastActivityHere, Number.isFinite(shared) ? shared : 0);
  } catch {
    return lastActivityHere;
  }
}

export type IdleStep = { signOut: boolean; warn: boolean; renew: boolean; secondsLeft: number };

/**
 * What to do now. Past the limit: sign out. Within two minutes of it: warn.
 * Active in the last minute and the session not renewed for a third of the
 * limit (at most ten minutes): renew it, so the API's own limit never bites a
 * person who is typing into a long form without saving.
 */
export function idleStep(input: { now: number; lastActivity: number; lastRenewed: number; limitMinutes: number }): IdleStep {
  const limitMs = input.limitMinutes * 60_000;
  const idleMs = input.now - input.lastActivity;
  const renewEveryMs = Math.min(10 * 60_000, limitMs / 3);
  return {
    signOut: idleMs >= limitMs,
    warn: idleMs >= limitMs - IDLE_WARNING_MS && idleMs < limitMs,
    renew: idleMs < 60_000 && input.now - input.lastRenewed >= renewEveryMs,
    secondsLeft: Math.max(0, Math.ceil((limitMs - idleMs) / 1000)),
  };
}

const SIGNED_OUT_KEY = 'acct_signed_out_idle';

/** Remembers, for the sign-in page, that this browser was signed out for being left alone. */
export function markSignedOutIdle(minutes: number): void {
  try { sessionStorage.setItem(SIGNED_OUT_KEY, String(minutes)); } catch { /* the notice is a nicety */ }
}

/** The idle limit the browser was signed out after, or null. */
export function readSignedOutIdle(): number | null {
  try {
    const value = sessionStorage.getItem(SIGNED_OUT_KEY);
    return value ? Number(value) : null;
  } catch {
    return null;
  }
}

/** Once the sign-in page has said it. */
export function clearSignedOutIdle(): void {
  try { sessionStorage.removeItem(SIGNED_OUT_KEY); } catch { /* nothing to clear */ }
}
