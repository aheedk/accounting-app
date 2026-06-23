// Local-timezone "today" as YYYY-MM-DD. new Date().toISOString() is UTC and
// rolls to tomorrow during the evening in western timezones.
// "2026-06-12" -> "June 12, 2026" (UTC-pinned so the label matches the ISO date).
export function fmtLongDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
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
