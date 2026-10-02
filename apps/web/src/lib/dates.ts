// Local-timezone "today" as YYYY-MM-DD. new Date().toISOString() is UTC and
// rolls to tomorrow during the evening in western timezones.
// "2026-06-12" -> "June 12, 2026" (UTC-pinned so the label matches the ISO date).
export function fmtLongDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function todayLocal(): string {
  const d = new Date();
  return dateToLocalIso(d);
}

export function dateToLocalIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function daysAgoLocal(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return dateToLocalIso(d);
}

export function addDaysLocal(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return dateToLocalIso(date);
}

export function currentYearLocal(): number {
  return new Date().getFullYear();
}

/**
 * Tidy what a date box holds once the user leaves it (YYYY-MM-DD).
 *
 * A two-digit year means this century: typing 26 gives 2026, the way
 * QuickBooks reads it (the browser's own date box would keep the year 0026).
 * Anything that is not a real calendar date falls back to `fallback`, the
 * last good value.
 */
export function normalizeDateInput(raw: string, fallback: string): string {
  if (!raw) return raw;
  const parts = raw.split('-');
  if (parts.length !== 3) return fallback;
  let y = parseInt(parts[0]!, 10);
  const m = parseInt(parts[1]!, 10);
  const d = parseInt(parts[2]!, 10);
  if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return fallback;
  if (y < 100) y += 2000;
  if (y < 1000 || y > 9999) return fallback;
  const date = new Date(y, m - 1, d);
  // If month/day rolled over the date is invalid (e.g. June 31 -> July 1).
  if (date.getMonth() !== m - 1 || date.getDate() !== d) return fallback;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
