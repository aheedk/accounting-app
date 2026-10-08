import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Calendar, X } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { cachedGet } from '@/lib/referenceDataCache';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { TableSettingsCustomizeButton } from '@/components/ui/TableSettingsDrawer';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/input';
import { AppSelect } from '@/components/ui/select';
import { PartySelect, type Party } from '@/components/ui/PartySelect';
import { fmtMoney } from '@/lib/money';
import { fmtDateTime } from '@/lib/dates';
import { pickErr } from '@/lib/apiErrors';

type TransactionType = 'deposit' | 'expense' | 'check' | 'journal' | 'bill' | 'payment' | 'credit_memo';

type TransactionRow = {
  id: string;
  type: TransactionType;
  date: string;
  ref_no: string | null;
  contact_id: string | null;
  contact_name: string | null;
  due_date: string | null;
  balance: string;
  payment_account_name: string | null;
  total_amount: string;
  memo: string | null;
  status: string;
  updated_at: string;
  path: string;
};

const TYPE_LABELS: Record<TransactionType, string> = {
  deposit: 'Deposit',
  expense: 'Expense',
  check: 'Check',
  journal: 'Journal Entry',
  bill: 'Bill',
  payment: 'Payment',
  credit_memo: 'Credit Memo',
};

// QBO's full transaction-type taxonomy, in its own order — shown so the
// dropdown reads as complete, but only the types transactionsService.ts
// actually unions in are selectable; the rest are disabled "(coming soon)"
// rather than silently returning zero rows if picked.
const QBO_TYPE_TAXONOMY: { label: string; type: TransactionType | null }[] = [
  { label: 'Advance payment', type: null },
  { label: 'Bill', type: 'bill' },
  { label: 'Bill payment', type: null },
  { label: 'Bill payment credit card', type: null },
  { label: 'Build assembly', type: null },
  { label: 'Cash expense', type: null },
  { label: 'Change order', type: null },
  { label: 'Check', type: 'check' },
  { label: 'Credit card', type: null },
  { label: 'Credit card credit', type: null },
  { label: 'Credit card payment', type: null },
  { label: 'Credit memo', type: 'credit_memo' },
  { label: 'Credit refund', type: null },
  { label: 'Deposit', type: 'deposit' },
  { label: 'Employee non-reimbursable expense', type: null },
  { label: 'Employee reimbursable expense', type: null },
  { label: 'Employee reimbursement', type: null },
  { label: 'Estimate', type: null },
  { label: 'Expense', type: 'expense' },
  { label: 'Global tax payment', type: null },
  { label: 'Invoice', type: null },
  { label: 'Item receipt', type: null },
  { label: 'Journal', type: 'journal' },
  { label: 'Manufacturing order', type: null },
  { label: 'Paycheck', type: null },
  { label: 'Payment', type: 'payment' },
  { label: 'Reverse charge', type: null },
  { label: 'Sales Order', type: null },
  { label: 'Sales receipt', type: null },
  { label: 'Tax adjustment', type: null },
  { label: 'Transfer', type: null },
  { label: 'Vendor credit', type: null },
];

// Status spellings are inconsistent across source tables ('void' vs 'voided',
// 'applied' is AR-only) — normalize to a small badge-color set by prefix match.
function statusPillClass(status: string): string {
  const s = status.toLowerCase();
  if (s.startsWith('void')) return 'bg-red-100 text-red-800';
  if (s === 'paid' || s === 'applied') return 'bg-emerald-100 text-emerald-800';
  if (s === 'posted') return 'bg-emerald-100 text-emerald-800';
  return 'bg-muted text-muted-foreground';
}

// 'unset' is this page's own sentinel for "no date filter yet" (the trigger
// shows "Select…") — it isn't one of the dropdown's own options.
const DATE_PRESETS = [
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
type DatePreset = (typeof DATE_PRESETS)[number]['value'] | 'unset';
const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  unset: 'Select…',
  ...Object.fromEntries(DATE_PRESETS.map(p => [p.value, p.label])),
} as Record<DatePreset, string>;

function presetRange(preset: DatePreset, customStart: string, customEnd: string): { start: string | null; end: string | null } {
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const startOfMonth = (y: number, m: number) => new Date(y, m, 1);
  const endOfMonth = (y: number, m: number) => new Date(y, m + 1, 0);
  // US convention: week starts Sunday.
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
    case 'this_year': return { start: iso(new Date(now.getFullYear(), 0, 1)), end: iso(new Date(now.getFullYear(), 11, 31)) };
    case 'last_year': return { start: iso(new Date(now.getFullYear() - 1, 0, 1)), end: iso(new Date(now.getFullYear() - 1, 11, 31)) };
    case 'last_7_years': return { start: iso(addYears(now, -7)), end: iso(now) };
  }
}

function DateRangeFilter({
  preset, start, end, onApply,
}: {
  preset: DatePreset; start: string; end: string;
  onApply: (next: { preset: DatePreset; start: string; end: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draftPreset, setDraftPreset] = useState<DatePreset>(preset === 'unset' ? 'custom' : preset);
  const [draftStart, setDraftStart] = useState(start);
  const [draftEnd, setDraftEnd] = useState(end);

  function openPopup() {
    setDraftPreset(preset === 'unset' ? 'custom' : preset);
    setDraftStart(start);
    setDraftEnd(end);
    setOpen(true);
  }

  function draftRange() {
    return draftPreset === 'custom' ? { start: draftStart, end: draftEnd } : presetRange(draftPreset, '', '');
  }

  function handleApply() {
    const range = draftRange();
    onApply({ preset: draftPreset, start: range.start ?? '', end: range.end ?? '' });
    setOpen(false);
  }
  function handleClear() {
    onApply({ preset: 'unset', start: '', end: '' });
    setOpen(false);
  }

  const displayRange = draftRange();

  return (
    <div className="relative">
      <label className="mb-1 block text-xs text-muted-foreground">Date range</label>
      <button
        type="button"
        onClick={openPopup}
        className="flex h-9 w-44 items-center justify-between rounded-md border bg-background px-3 text-sm text-left"
      >
        <span className={preset === 'unset' ? 'text-muted-foreground' : ''}>{DATE_PRESET_LABELS[preset]}</span>
        <Calendar className="h-4 w-4 text-muted-foreground" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 w-[420px] rounded-md border bg-white p-4 shadow-lg dark:bg-zinc-900">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Date range</h3>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close">
                <X className="h-4 w-4 text-muted-foreground hover:text-foreground" />
              </button>
            </div>
            <div className="mb-4 grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Date</label>
                <AppSelect
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                  value={draftPreset}
                  onChange={e => setDraftPreset(e.target.value as DatePreset)}
                >
                  {DATE_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </AppSelect>
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">From</label>
                <Input
                  type="date"
                  className="h-9 w-full"
                  value={draftPreset === 'custom' ? draftStart : (displayRange.start ?? '')}
                  disabled={draftPreset !== 'custom'}
                  onChange={e => setDraftStart(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">To</label>
                <Input
                  type="date"
                  className="h-9 w-full"
                  value={draftPreset === 'custom' ? draftEnd : (displayRange.end ?? '')}
                  disabled={draftPreset !== 'custom'}
                  onChange={e => setDraftEnd(e.target.value)}
                />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Button type="button" variant="outline" size="sm" onClick={handleClear}>Clear</Button>
              <Button type="button" size="sm" onClick={handleApply}>Apply</Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

type AmountOp = 'eq' | 'between' | 'lt' | 'lte' | 'gt' | 'gte';
const AMOUNT_OPS: { value: AmountOp; label: string }[] = [
  { value: 'eq', label: 'Equals' },
  { value: 'between', label: 'Between' },
  { value: 'lt', label: 'Less than' },
  { value: 'lte', label: 'Less than or equal' },
  { value: 'gt', label: 'Greater than' },
  { value: 'gte', label: 'Greater than or equal' },
];

// "Amount type" matches QBO's own options so the UI reads as complete, but
// line-level amounts aren't in transactionsService.ts's unified row (it only
// carries each transaction's total) — all three options filter total_amount
// today. Scoped decision; flagged in docs/backlog.md.
type AmountType = 'line_or_total' | 'total' | 'line';
const AMOUNT_TYPES: { value: AmountType; label: string }[] = [
  { value: 'line_or_total', label: 'Line or total' },
  { value: 'total', label: 'Total' },
  { value: 'line', label: 'Line' },
];

type AmountFilterState = { op: AmountOp; type: AmountType; value: string; value2: string } | null;

function fmtAmountDisplay(n: AmountFilterState): string {
  if (!n) return 'Select…';
  const v = (s: string) => `$${s || '0.00'}`;
  if (n.op === 'between') return `Between ${v(n.value)} - ${v(n.value2)}`;
  const opLabel = AMOUNT_OPS.find(o => o.value === n.op)?.label ?? '';
  return `${opLabel} ${v(n.value)}`;
}

function AmountFilter({ value, onApply }: { value: AmountFilterState; onApply: (next: AmountFilterState) => void }) {
  const [open, setOpen] = useState(false);
  const [draftType, setDraftType] = useState<AmountType>(value?.type ?? 'line_or_total');
  const [draftOp, setDraftOp] = useState<AmountOp>(value?.op ?? 'eq');
  const [draftValue, setDraftValue] = useState(value?.value ?? '');
  const [draftValue2, setDraftValue2] = useState(value?.value2 ?? '');

  function openPopup() {
    setDraftType(value?.type ?? 'line_or_total');
    setDraftOp(value?.op ?? 'eq');
    setDraftValue(value?.value ?? '');
    setDraftValue2(value?.value2 ?? '');
    setOpen(true);
  }
  function handleApply() {
    onApply({ op: draftOp, type: draftType, value: draftValue || '0.00', value2: draftValue2 || '0.00' });
    setOpen(false);
  }
  function handleClear() {
    onApply(null);
    setOpen(false);
  }

  return (
    <div className="relative">
      <label className="mb-1 block text-xs text-muted-foreground">Amount</label>
      <button
        type="button"
        onClick={openPopup}
        className="flex h-9 w-32 items-center justify-between rounded-md border bg-background px-3 text-sm text-left"
      >
        <span className={`truncate ${value ? '' : 'text-muted-foreground'}`}>{fmtAmountDisplay(value)}</span>
        <svg className="h-3 w-3 shrink-0 text-muted-foreground" viewBox="0 0 12 12" fill="none"><path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 w-[300px] rounded-md border bg-white p-4 shadow-lg dark:bg-zinc-900">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Amount</h3>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close">
                <X className="h-4 w-4 text-muted-foreground hover:text-foreground" />
              </button>
            </div>
            <div className="mb-3">
              <label className="mb-1 block text-xs text-muted-foreground">Amount type</label>
              <AppSelect
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={draftType}
                onChange={e => setDraftType(e.target.value as AmountType)}
              >
                {AMOUNT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </AppSelect>
            </div>
            <div className="mb-4 flex gap-3">
              <div className="flex-1">
                <label className="mb-1 block text-xs text-muted-foreground">Amount</label>
                <AppSelect
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                  value={draftOp}
                  onChange={e => setDraftOp(e.target.value as AmountOp)}
                >
                  {AMOUNT_OPS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </AppSelect>
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-xs text-muted-foreground">Amount</label>
                <Input
                  className="h-9 w-full font-mono"
                  placeholder="$0.00"
                  value={draftValue}
                  onChange={e => setDraftValue(e.target.value)}
                />
              </div>
            </div>
            {draftOp === 'between' && (
              <div className="-mt-2 mb-4">
                <label className="mb-1 block text-xs text-muted-foreground">And</label>
                <Input
                  className="h-9 w-full font-mono"
                  placeholder="$0.00"
                  value={draftValue2}
                  onChange={e => setDraftValue2(e.target.value)}
                />
              </div>
            )}
            <div className="flex items-center justify-between">
              <Button type="button" variant="outline" size="sm" onClick={handleClear}>Clear</Button>
              <Button type="button" size="sm" onClick={handleApply}>Apply</Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const PAGE_SIZE = 25;

export default function TransactionsPage() {
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();

  const [rows, setRows] = useState<TransactionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [err, setErr] = useState<string | null>(null);
  const [parties, setParties] = useState<Party[]>([]);

  const typeFilter = (params.get('type') as TransactionType | null) ?? null;
  // No date filter until the user picks one from the popup (matches the
  // "Select…" empty state) — unlike the old plain dropdown, which defaulted
  // to Last 30 days.
  const [datePreset, setDatePreset] = useState<DatePreset>('unset');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [refNo, setRefNo] = useState('');
  const [contactId, setContactId] = useState('');
  const [contactText, setContactText] = useState('');
  const [amountFilter, setAmountFilter] = useState<AmountFilterState>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (!bizId) return;
    (async () => {
      const [custData, vendData] = await Promise.all([
        cachedGet<{ customers: Array<{ id: string; name: string }> }>(`/businesses/${bizId}/customers`),
        cachedGet<{ vendors: Array<{ id: string; name: string }> }>(`/businesses/${bizId}/vendors`),
      ]);
      setParties([
        ...(vendData?.vendors ?? []).map((v: { id: string; name: string }) => ({ id: v.id, type: 'vendor' as const, name: v.name })),
        ...(custData?.customers ?? []).map((c: { id: string; name: string }) => ({ id: c.id, type: 'customer' as const, name: c.name })),
      ]);
    })();
  }, [bizId]);

  const reload = useCallback(async () => {
    if (!bizId) { setRows([]); setTotal(0); return; }
    setErr(null);
    const range = presetRange(datePreset, customStart, customEnd);
    const query: Record<string, string> = {
      page: String(page),
      page_size: String(PAGE_SIZE),
    };
    if (typeFilter) query['type'] = typeFilter;
    if (range.start) query['date_start'] = range.start;
    if (range.end) query['date_end'] = range.end;
    if (refNo.trim()) query['ref_no'] = refNo.trim();
    if (contactId) query['contact_id'] = contactId;
    if (amountFilter) {
      query['amount_op'] = amountFilter.op;
      query['amount_value'] = amountFilter.value;
      if (amountFilter.op === 'between') query['amount_value2'] = amountFilter.value2;
    }
    try {
      const r = await api.get<{ transactions: TransactionRow[]; total: number }>(
        `/businesses/${bizId}/transactions`, { params: query },
      );
      setRows(r.data.transactions);
      setTotal(r.data.total);
    } catch (e: unknown) {
      setErr(pickErr(e));
    }
  }, [bizId, typeFilter, datePreset, customStart, customEnd, refNo, contactId, amountFilter, page]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { setPage(1); }, [typeFilter, datePreset, customStart, customEnd, refNo, contactId, amountFilter]);

  function clearTypeFilter() {
    const next = new URLSearchParams(params);
    next.delete('type');
    setParams(next);
  }

  const columns: Column<TransactionRow>[] = useMemo(() => [
    { key: 'date', header: 'Date', sortable: true, sortValue: r => r.date, render: r => <span className="whitespace-nowrap">{r.date}</span> },
    { key: 'type', header: 'Type', sortable: true, sortValue: r => TYPE_LABELS[r.type], render: r => TYPE_LABELS[r.type] },
    { key: 'ref_no', header: 'Ref No.', sortable: true, sortValue: r => r.ref_no ?? '', render: r => r.ref_no ?? <span className="text-muted-foreground">—</span> },
    {
      key: 'contact_name', header: 'Contact', sortable: true, sortValue: r => r.contact_name ?? '',
      render: r => r.contact_name ? <span className="text-blue-600">{r.contact_name}</span> : <span className="text-muted-foreground">—</span>,
    },
    // Only bills carry a real due date in this unified view (see
    // transactionsService.ts) — every other type renders a dash.
    { key: 'due_date', header: 'Due Date', sortable: true, sortValue: r => r.due_date ?? '', render: r => r.due_date ?? <span className="text-muted-foreground">—</span> },
    { key: 'balance', header: 'Balance', align: 'right', sortable: true, sortValue: r => Number(r.balance), render: r => <span className="font-mono">{fmtMoney(r.balance)}</span> },
    { key: 'total_amount', header: 'Total Amount', align: 'right', sortable: true, sortValue: r => Number(r.total_amount), render: r => <span className="font-mono">{fmtMoney(r.total_amount)}</span> },
    { key: 'memo', header: 'Memo', sortable: true, sortValue: r => r.memo ?? '', render: r => r.memo || <span className="text-muted-foreground">—</span> },
    { key: 'updated_at', header: 'Last Modified', sortable: true, sortValue: r => r.updated_at, render: r => <span className="whitespace-nowrap text-muted-foreground">{fmtDateTime(r.updated_at)}</span> },
    {
      key: 'status', header: 'Status', sortable: true, sortValue: r => r.status,
      render: r => <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusPillClass(r.status)}`}>{r.status}</span>,
    },
  ], []);

  if (!bizId) return <div>Pick a business.</div>;

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(total, page * PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Transactions</h1>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <DateRangeFilter
            preset={datePreset}
            start={customStart}
            end={customEnd}
            onApply={next => { setDatePreset(next.preset); setCustomStart(next.start); setCustomEnd(next.end); }}
          />
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Transaction type</label>
            <AppSelect
              className="h-9 w-48 rounded-md border bg-background px-3 text-sm"
              value={typeFilter ?? 'all'}
              onChange={e => {
                const next = new URLSearchParams(params);
                if (e.target.value === 'all') next.delete('type'); else next.set('type', e.target.value);
                setParams(next);
              }}
            >
              <option value="all">All types</option>
              {QBO_TYPE_TAXONOMY.map(({ label, type }) => (
                <option key={label} value={type ?? ''} disabled={!type}>
                  {type ? label : `${label} (coming soon)`}
                </option>
              ))}
            </AppSelect>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Reference number</label>
            <Input className="h-9 w-36" placeholder="Search…" value={refNo} onChange={e => setRefNo(e.target.value)} />
          </div>
          <div className="w-56">
            <label className="mb-1 block text-xs text-muted-foreground">Contact</label>
            <PartySelect
              parties={parties}
              value={contactId}
              text={contactText}
              onPick={p => { setContactId(p.id); setContactText(p.name); }}
              onTextChange={t => { setContactText(t); if (!t) setContactId(''); }}
              placeholder="Any contact"
              className="w-full"
            />
          </div>
          <AmountFilter value={amountFilter} onApply={setAmountFilter} />
        </div>
        <TableSettingsCustomizeButton onClick={() => setSettingsOpen(true)} />
      </div>

      {typeFilter && (
        <span className="inline-flex h-8 items-center gap-2 rounded-full border bg-muted/40 px-3 text-sm">
          Transaction type: <span className="font-medium">{TYPE_LABELS[typeFilter]}</span>
          <button type="button" onClick={clearTypeFilter} aria-label="Clear transaction type filter">
            <X className="h-3.5 w-3.5 text-muted-foreground/70 hover:text-foreground" />
          </button>
        </span>
      )}

      {err && <p className="text-sm text-destructive">{err}</p>}

      <Card><CardContent className="p-0">
        {/* Pagination is server-side (the filter set spans 7 tables), so no
            `pagination` prop here — column sort/visibility from Table
            Settings still apply, but only within the current page of rows. */}
        <DataTable
          rows={rows}
          getRowId={r => `${r.type}:${r.id}`}
          columns={columns}
          selectable={false}
          onRowClick={r => nav(r.path)}
          defaultSortKey="date"
          defaultSortDir="desc"
          tableSettingsPageId="transactions"
          externalSettingsOpen={settingsOpen}
          onExternalSettingsOpenChange={setSettingsOpen}
          // QBO's own "Sort by" list, in its own order.
          sortableFields={[
            { key: 'date', label: 'Date' },
            { key: 'type', label: 'Type' },
            { key: 'ref_no', label: 'Ref no.' },
            { key: 'due_date', label: 'Due date' },
            { key: 'balance', label: 'Balance' },
            { key: 'total_amount', label: 'Total amount' },
            { key: 'updated_at', label: 'Last modified date' },
          ]}
          // QBO's own available-filters list. Date range/Transaction
          // type/Reference number/Contact/Amount are wired to real filter
          // bar controls above; Memo/Description/Tracking number/Address/
          // Products & services/Accounts/Project/P.O. Number are listed (and
          // reorderable/hideable here) for parity but have no backing filter
          // control yet — see docs/backlog.md.
          availableFilters={[
            { key: 'date_range', label: 'Date range' },
            { key: 'transaction_type', label: 'Transaction type' },
            { key: 'ref_no', label: 'Reference number' },
            { key: 'contact', label: 'Contact' },
            { key: 'amount', label: 'Amount' },
            { key: 'memo', label: 'Memo' },
            { key: 'description', label: 'Description' },
            { key: 'tracking_number', label: 'Tracking number' },
            { key: 'address', label: 'Address' },
            { key: 'products_services', label: 'Products & services' },
            { key: 'accounts', label: 'Accounts' },
            { key: 'project', label: 'Project' },
            { key: 'po_number', label: 'P.O. Number' },
          ]}
          emptyMessage={<EmptyState title="No transactions found" hint="Adjust the filters above." />}
        />
        <div className="flex items-center justify-end gap-1 border-t px-3 py-1.5 text-sm">
          <button type="button" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} className="px-1.5 py-1 text-muted-foreground enabled:hover:text-foreground disabled:opacity-40">Previous</button>
          <span className="px-1 tabular-nums">{rangeStart}-{rangeEnd}</span>
          <button type="button" disabled={page >= pageCount} onClick={() => setPage(p => Math.min(pageCount, p + 1))} className="px-1.5 py-1 text-muted-foreground enabled:hover:text-foreground disabled:opacity-40">Next</button>
        </div>
      </CardContent></Card>
    </div>
  );
}
