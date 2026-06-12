// Local-timezone "today" as YYYY-MM-DD. new Date().toISOString() is UTC and
// rolls to tomorrow during the evening in western timezones.
export function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
