import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '../../db/types.js';

// An access token is good for a few minutes and is checked without the
// database, so signing out, ending a session from another browser, or switching
// a login off would otherwise take that long to bite. This keeps, in memory,
// which sessions have ended and, for a login ended as a whole, the moment before
// which its access tokens stop counting. The auth middleware asks on every request.
//
// It is per process. One API instance runs today; with more than one, the
// others would catch up when the token expires (minutes), not at once. A
// restart reloads it from the database (loadRecentRevocations).

/** user id → epoch seconds. A token issued before this is refused. */
const revokedBefore = new Map<string, number>();

export function revokeAccessTokensBefore(userId: string, epochSeconds: number): void {
  const current = revokedBefore.get(userId) ?? 0;
  if (epochSeconds > current) revokedBefore.set(userId, epochSeconds);
}

/** session id → when to forget it (epoch ms): once every token it could have issued has expired. */
const endedSessions = new Map<string, number>();
const FORGET_AFTER_MS = 60 * 60 * 1000;

export function revokeSession(sessionId: string): void {
  const now = Date.now();
  for (const [id, forgetAt] of endedSessions) if (forgetAt < now) endedSessions.delete(id);
  endedSessions.set(sessionId, now + FORGET_AFTER_MS);
}

/** `iat` is the token's issued-at, in epoch seconds; `sid` its session, when it names one. */
export function accessTokenRevoked(userId: string, iat: number, sid?: string): boolean {
  if (sid !== undefined && endedSessions.has(sid)) return true;
  const moment = revokedBefore.get(userId);
  return moment !== undefined && iat < moment;
}

/** For tests. */
export function clearAccessTokenRevocations(): void {
  revokedBefore.clear();
  endedSessions.clear();
}

/** At start-up: pick up revocations recent enough that a token from before them could still be alive. */
export async function loadRecentRevocations(db: Kysely<DB>, accessTtlMinutes: number): Promise<void> {
  const rows = await db.selectFrom('users')
    .select(['id', 'sessions_revoked_at'])
    .where('sessions_revoked_at', '>', sql<Date>`now() - make_interval(mins => ${accessTtlMinutes + 1})`)
    .execute();
  for (const row of rows) {
    if (row.sessions_revoked_at) revokeAccessTokensBefore(row.id, Math.ceil(new Date(row.sessions_revoked_at).getTime() / 1000));
  }
  // Sessions ended recently: every token of theirs is revoked. (A session that was
  // only renewed has a live token, so it is not one of these.)
  const ended = await db.selectFrom('refresh_tokens')
    .select('session_id')
    .groupBy('session_id')
    .having(sql<boolean>`bool_and(revoked_at IS NOT NULL) AND max(revoked_at) > now() - make_interval(mins => ${accessTtlMinutes + 1})`)
    .execute();
  for (const row of ended) revokeSession(row.session_id);
}
