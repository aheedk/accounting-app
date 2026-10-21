// A count per key over a sliding hour (or any window), kept in memory: the API
// runs as one process, and a restart only forgets the counts. For things that
// cost money or effort per call, where a login in the wrong hands, or a script,
// could otherwise send without end (security review 2026-10-21).

type Window = { count: number; since: number };

export class RateLimit {
  private readonly byKey = new Map<string, Window>();

  constructor(private readonly limit: number, private readonly windowMs: number) {}

  /**
   * Counts one for `key` and returns null, or, when the limit is reached,
   * counts nothing and returns how many minutes until it lifts.
   */
  take(key: string, now = Date.now()): number | null {
    let entry = this.byKey.get(key);
    if (entry && now - entry.since >= this.windowMs) entry = undefined;
    if (!entry) {
      entry = { count: 0, since: now };
      this.byKey.set(key, entry);
    }
    if (entry.count >= this.limit) return Math.max(1, Math.ceil((entry.since + this.windowMs - now) / 60000));
    entry.count += 1;
    if (this.byKey.size > 10_000) {
      for (const [k, v] of this.byKey) if (now - v.since >= this.windowMs) this.byKey.delete(k);
    }
    return null;
  }

  /** Tests only. */
  reset(): void {
    this.byKey.clear();
  }
}
