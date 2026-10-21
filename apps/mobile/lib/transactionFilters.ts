// Direct port of apps/web/src/pages/accounting/TransactionsPage.tsx's
// DATE_PRESETS/presetRange (same preset set, same math) so mobile's date
// range filter computes identical start/end dates to web's.

export const DATE_PRESETS = [
  { value: 'custom', label: 'Custom' },
  { value: '7d', label: 'Last 7 days' },
  { value: '14d', label: 'Last 14 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '3m', label: 'Last 3 months' },
  { value: 'previous_week', label: 'Previous week' },
  { value: 'previous_month', label: 'Previous month' },
  { value: 'previous_quarter', label: 'Previous quarter' },
  { value: 'this_week', label: 'This week' },
  { value: 'this_year', label: 'This year' },
  { value: 'last_year', label: 'Last year' },
  { value: 'last_7_years', label: 'Last 7 years' },
] as const;
export type DatePreset = (typeof DATE_PRESETS)[number]['value'] | 'unset';
export const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  unset: 'All dates',
  custom: 'Custom',
  '7d': 'Last 7 days', '14d': 'Last 14 days', '30d': 'Last 30 days', '3m': 'Last 3 months',
  previous_week: 'Previous week', previous_month: 'Previous month', previous_quarter: 'Previous quarter',
  this_week: 'This week', this_year: 'This year', last_year: 'Last year', last_7_years: 'Last 7 years',
};

function validMonth(m: number | undefined): number {
  return m && m >= 1 && m <= 12 ? m : 1;
}

/** The fiscal year containing `date` (YYYY-MM-DD), starting the given month; `shift` -1 = the year before. */
export function fiscalYearRange(date: string, startMonth: number, shift = 0): { start: string; end: string } {
  const month = validMonth(startMonth);
  const year = Number(date.slice(0, 4));
  const startYear = (Number(date.slice(5, 7)) >= month ? year : year - 1) + shift;
  const end = new Date(Date.UTC(startYear + 1, month - 1, 0)).toISOString().slice(0, 10);
  return { start: `${startYear}-${String(month).padStart(2, '0')}-01`, end };
}

export function presetRange(
  preset: DatePreset, customStart: string, customEnd: string, fiscalStartMonth = 1,
): { start: string | null; end: string | null } {
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const startOfMonth = (y: number, m: number) => new Date(y, m, 1);
  const endOfMonth = (y: number, m: number) => new Date(y, m + 1, 0);
  const startOfWeek = (d: Date) => { const s = new Date(d); s.setDate(s.getDate() - s.getDay()); return s; };
  const addDays = (d: Date, n: number) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
  const addMonths = (d: Date, n: number) => { const r = new Date(d); r.setMonth(r.getMonth() + n); return r; };
  const addYears = (d: Date, n: number) => { const r = new Date(d); r.setFullYear(r.getFullYear() + n); return r; };
  switch (preset) {
    case 'unset': return { start: null, end: null };
    case 'custom': return { start: customStart || null, end: customEnd || null };
    case '7d': return { start: iso(addDays(now, -7)), end: iso(now) };
    case '14d': return { start: iso(addDays(now, -14)), end: iso(now) };
    case '30d': return { start: iso(addDays(now, -30)), end: iso(now) };
    case '3m': return { start: iso(addMonths(now, -3)), end: iso(now) };
    case 'previous_week': { const s = addDays(startOfWeek(now), -7); return { start: iso(s), end: iso(addDays(s, 6)) }; }
    case 'previous_month': return { start: iso(startOfMonth(now.getFullYear(), now.getMonth() - 1)), end: iso(endOfMonth(now.getFullYear(), now.getMonth() - 1)) };
    case 'previous_quarter': { const q = Math.floor(now.getMonth() / 3) - 1; const y = now.getFullYear() + (q < 0 ? -1 : 0); const qq = (q + 4) % 4; return { start: iso(startOfMonth(y, qq * 3)), end: iso(endOfMonth(y, qq * 3 + 2)) }; }
    case 'this_week': { const s = startOfWeek(now); return { start: iso(s), end: iso(addDays(s, 6)) }; }
    case 'this_year': return fiscalYearRange(iso(now), fiscalStartMonth);
    case 'last_year': return fiscalYearRange(iso(now), fiscalStartMonth, -1);
    case 'last_7_years': return { start: iso(addYears(now, -7)), end: iso(now) };
  }
}

export type AmountOp = 'eq' | 'between' | 'lt' | 'lte' | 'gt' | 'gte';
export const AMOUNT_OPS: Array<{ value: AmountOp; label: string }> = [
  { value: 'eq', label: 'Equals' },
  { value: 'between', label: 'Between' },
  { value: 'lt', label: 'Less than' },
  { value: 'lte', label: 'Less than or equal' },
  { value: 'gt', label: 'Greater than' },
  { value: 'gte', label: 'Greater than or equal' },
];

export type TransactionFilters = {
  type: string;
  datePreset: DatePreset;
  dateStart: string;
  dateEnd: string;
  refNo: string;
  contactId: string | null;
  contactLabel: string | null;
  amountOp: AmountOp | null;
  amountValue: string;
  amountValue2: string;
};

export const EMPTY_FILTERS: TransactionFilters = {
  type: '', datePreset: 'unset', dateStart: '', dateEnd: '', refNo: '',
  contactId: null, contactLabel: null, amountOp: null, amountValue: '', amountValue2: '',
};

export function countActiveFilters(f: TransactionFilters): number {
  let n = 0;
  if (f.type) n++;
  if (f.datePreset !== 'unset') n++;
  if (f.refNo.trim()) n++;
  if (f.contactId) n++;
  if (f.amountOp && f.amountValue.trim()) n++;
  return n;
}
