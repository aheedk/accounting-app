/** Same behavior as apps/web/src/lib/money.ts's fmtMoney — no $ sign, comma
 * thousands separators, always 2dp. Kept as its own copy for the same reason
 * as pickErr (see services/apiClient.ts): this first chunk doesn't touch the
 * stable web app's files. */
export function fmtMoney(value: string | number | null | undefined): string {
  if (value === '' || value == null) return '0.00';
  const n = typeof value === 'number' ? value : parseFloat(value);
  if (Number.isNaN(n)) return '0.00';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtShortDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  if (!y || !m || !d) return iso;
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}
