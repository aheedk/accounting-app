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
 * "This year"'s start/end for a business whose fiscal year starts in
 * `startMonth` (1-12, from businesses.fiscal_year_start_month) — the fiscal
 * year containing today, not the calendar year. startMonth 1 reduces to the
 * plain calendar year, so a page that hasn't fetched the business yet can
 * default to 1 and get today's existing calendar-year behavior unchanged.
 * Mirrors GeneralLedgerPage's own fiscalYearStart/fiscalYearEnd, generalized
 * so every "This year" preset in the app can share one implementation
 * (2026-10-10 meeting, item 40) instead of each page rolling its own.
 */
export function fiscalYearBoundsLocal(startMonth: number, today: Date = new Date()): { start: string; end: string } {
  const m = startMonth - 1;
  const year = today.getMonth() >= m ? today.getFullYear() : today.getFullYear() - 1;
  const start = new Date(year, m, 1);
  const end = new Date(year + 1, m, 0);
  return { start: dateToLocalIso(start), end: dateToLocalIso(end) };
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
