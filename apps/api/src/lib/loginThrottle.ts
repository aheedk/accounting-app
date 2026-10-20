// Each login is held after 5 wrong tries (services/auth/authService.ts). This
// covers the other case: one address trying many logins, a common password
// against every email it can find. Counts are kept in memory; the API runs as
// one process, and a restart only forgets them.
//
// A successful sign-in from an address clears its count. So if every visitor
// ever arrived as one address (the proxy setting in app.ts gone wrong), ordinary
// use would keep clearing it and the firm would not be locked out.

export const MAX_FAILURES_PER_ADDRESS = 20;
const WINDOW_MS = 15 * 60 * 1000;

type Entry = { failures: number; since: number };
const byAddress = new Map<string, Entry>();

function current(address: string, now: number): Entry | undefined {
  const entry = byAddress.get(address);
  if (entry && now - entry.since >= WINDOW_MS) {
    byAddress.delete(address);
    return undefined;
  }
  return entry;
}

/** Why this address may not try to sign in now, or null when it may. */
export function addressRefusal(address: string, now = Date.now()): string | null {
  const entry = current(address, now);
  if (!entry || entry.failures < MAX_FAILURES_PER_ADDRESS) return null;
  const minutes = Math.max(1, Math.ceil((entry.since + WINDOW_MS - now) / 60000));
  return `Too many sign-in attempts from this network. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}

export function recordFailedSignIn(address: string, now = Date.now()): void {
  const entry = current(address, now);
  if (entry) entry.failures += 1;
  else byAddress.set(address, { failures: 1, since: now });
  // Expired entries are otherwise only dropped when their address comes back.
  if (byAddress.size > 10_000) {
    for (const [key, value] of byAddress) if (now - value.since >= WINDOW_MS) byAddress.delete(key);
  }
}

export function clearSignInFailures(address: string): void {
  byAddress.delete(address);
}

/** Tests only. */
export function resetLoginThrottle(): void {
  byAddress.clear();
}
