import { api } from './apiClient';

type CacheEntry<T> = { promise: Promise<T>; expiresAt: number };
const cache = new Map<string, CacheEntry<unknown>>();
const DEFAULT_TTL_MS = 30_000;

/**
 * Dedupes and short-TTL-caches GET requests for slow-changing reference data
 * (chart of accounts, customers, vendors, bank accounts) that many independent
 * page components each fetch on mount with no sharing — confirmed across 28+
 * pages for /coa alone, which is what turns a few page visits into hundreds
 * of redundant requests queuing behind the browser's per-origin connection
 * limit. This is a per-tab, in-memory cache keyed by exact URL; it does not
 * persist across reloads. Scoped intentionally to the pages that opt in by
 * calling it, not a global fetch interceptor — rolling it out further is a
 * separate, bigger pass across the rest of the app.
 */
export function cachedGet<T>(url: string, ttlMs = DEFAULT_TTL_MS): Promise<T> {
  const hit = cache.get(url);
  const now = Date.now();
  if (hit && hit.expiresAt > now) return hit.promise as Promise<T>;

  const promise = api.get<T>(url).then(r => r.data);
  cache.set(url, { promise, expiresAt: now + ttlMs });
  // Don't cache a failed request — let the next caller retry immediately.
  promise.catch(() => cache.delete(url));
  return promise;
}

export function invalidateReferenceCache(prefix?: string): void {
  if (!prefix) { cache.clear(); return; }
  for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key);
}
