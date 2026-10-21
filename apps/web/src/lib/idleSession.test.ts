import { describe, expect, it } from 'vitest';
import { idleLimitWords, idleStep } from './idleSession';

const MIN = 60_000;
const at = (idleMinutes: number, renewedMinutesAgo = 0, limitMinutes = 60) =>
  idleStep({ now: 1_000 * MIN, lastActivity: 1_000 * MIN - idleMinutes * MIN, lastRenewed: 1_000 * MIN - renewedMinutesAgo * MIN, limitMinutes });

// Security review 2026-10-21: the idle sign-out.
describe('idleStep', () => {
  it('warns two minutes before the limit and signs out at it', () => {
    expect(at(57)).toMatchObject({ warn: false, signOut: false });
    expect(at(58.5)).toMatchObject({ warn: true, signOut: false, secondsLeft: 90 });
    expect(at(60)).toMatchObject({ warn: false, signOut: true });
  });

  it('renews the session while the person is active, and not when they are away', () => {
    expect(at(0.5, 11).renew).toBe(true);
    expect(at(0.5, 5).renew).toBe(false);
    expect(at(5, 30).renew).toBe(false);
    // A short limit renews more often: a third of it.
    expect(at(0.5, 6, 15).renew).toBe(true);
  });

  it('says the limit in words', () => {
    expect([15, 30, 60, 120, 180].map(idleLimitWords)).toEqual(['15 minutes', '30 minutes', '1 hour', '2 hours', '3 hours']);
  });
});
