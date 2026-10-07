import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { X } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { cachedGet } from '@/lib/referenceDataCache';
import { useActiveBusinessId } from '@/lib/business';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/DataTable';
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

const TYPE_OPTIONS = Object.entries(TYPE_LABELS) as [TransactionType, string][];

// Status spellings are inconsistent across source tables ('void' vs 'voided',
// 'applied' is AR-only) — normalize to a small badge-color set by prefix match.
function statusPillClass(status: string): string {
  const s = status.toLowerCase();
  if (s.startsWith('void')) return 'bg-red-100 text-red-800';
  if (s === 'paid' || s === 'applied') return 'bg-emerald-100 text-emerald-800';
  if (s === 'posted') return 'bg-emerald-100 text-emerald-800';
  return 'bg-muted text-muted-foreground';
}

const DATE_PRESETS = [
  { value: 'all', label: 'All dates' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'this_quarter', label: 'This quarter' },
  { value: 'this_year', label: 'This year' },
  { value: 'custom', label: 'Custom range' },
] as const;
type DatePreset = (typeof DATE_PRESETS)[number]['value'];

function presetRange(preset: DatePreset): { start: string | null; end: string | null } {
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const startOfMonth = (y: number, m: number) => new Date(y, m, 1);
  const endOfMonth = (y: number, m: number) => new Date(y, m + 1, 0);
  switch (preset) {
    case 'all': return { start: null, end: null };
    case '7d': { const s = new Date(now); s.setDate(s.getDate() - 7); return { start: iso(s), end: iso(now) }; }
    case '30d': { const s = new Date(now); s.setDate(s.getDate() - 30); return { start: iso(s), end: iso(now) }; }
    case 'this_month': return { start: iso(startOfMonth(now.getFullYear(), now.getMonth())), end: iso(endOfMonth(now.getFullYear(), now.getMonth())) };
    case 'last_month': return { start: iso(startOfMonth(now.getFullYear(), now.getMonth() - 1)), end: iso(endOfMonth(now.getFullYear(), now.getMonth() - 1)) };
    case 'this_quarter': { const q = Math.floor(now.getMonth() / 3); return { start: iso(startOfMonth(now.getFullYear(), q * 3)), end: iso(endOfMonth(now.getFullYear(), q * 3 + 2)) }; }
    case 'this_year': return { start: iso(new Date(now.getFullYear(), 0, 1)), end: iso(new Date(now.getFullYear(), 11, 31)) };
    case 'custom': return { start: null, end: null };
  }
}

type AmountOp = 'any' | 'eq' | 'gt' | 'lt' | 'between';

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
  const [datePreset, setDatePreset] = useState<DatePreset>('30d');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [refNo, setRefNo] = useState('');
  const [contactId, setContactId] = useState('');
  const [contactText, setContactText] = useState('');
  const [amountOp, setAmountOp] = useState<AmountOp>('any');
  const [amountValue, setAmountValue] = useState('');
  const [amountValue2, setAmountValue2] = useState('');

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
    const range = datePreset === 'custom' ? { start: customStart || null, end: customEnd || null } : presetRange(datePreset);
    const query: Record<string, string> = {
      page: String(page),
      page_size: String(PAGE_SIZE),
    };
    if (typeFilter) query['type'] = typeFilter;
    if (range.start) query['date_start'] = range.start;
    if (range.end) query['date_end'] = range.end;
    if (refNo.trim()) query['ref_no'] = refNo.trim();
    if (contactId) query['contact_id'] = contactId;
    if (amountOp !== 'any' && amountValue) {
      query['amount_op'] = amountOp;
      query['amount_value'] = amountValue;
      if (amountOp === 'between' && amountValue2) query['amount_value2'] = amountValue2;
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
  }, [bizId, typeFilter, datePreset, customStart, customEnd, refNo, contactId, amountOp, amountValue, amountValue2, page]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { setPage(1); }, [typeFilter, datePreset, customStart, customEnd, refNo, contactId, amountOp, amountValue, amountValue2]);

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
      key: 'contact_name', header: 'Payee/Contact', sortable: true, sortValue: r => r.contact_name ?? '',
      render: r => r.contact_name ? <span className="text-blue-600">{r.contact_name}</span> : <span className="text-muted-foreground">—</span>,
    },
    { key: 'payment_account_name', header: 'Payment Account', sortable: true, sortValue: r => r.payment_account_name ?? '', render: r => r.payment_account_name ?? <span className="text-muted-foreground">—</span> },
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

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Date range</label>
          <AppSelect className="h-9 w-40 rounded-md border bg-background px-3 text-sm" value={datePreset} onChange={e => setDatePreset(e.target.value as DatePreset)}>
            {DATE_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </AppSelect>
        </div>
        {datePreset === 'custom' && (
          <>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">From</label>
              <Input type="date" className="h-9 w-36" value={customStart} onChange={e => setCustomStart(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">To</label>
              <Input type="date" className="h-9 w-36" value={customEnd} onChange={e => setCustomEnd(e.target.value)} />
            </div>
          </>
        )}
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Transaction type</label>
          <AppSelect
            className="h-9 w-40 rounded-md border bg-background px-3 text-sm"
            value={typeFilter ?? 'all'}
            onChange={e => {
              const next = new URLSearchParams(params);
              if (e.target.value === 'all') next.delete('type'); else next.set('type', e.target.value);
              setParams(next);
            }}
          >
            <option value="all">All types</option>
            {TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
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
            className="h-9 rounded-md border bg-background px-3 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Amount</label>
          <div className="flex gap-1.5">
            <AppSelect className="h-9 w-32 rounded-md border bg-background px-2 text-sm" value={amountOp} onChange={e => setAmountOp(e.target.value as AmountOp)}>
              <option value="any">Any</option>
              <option value="eq">Equal to</option>
              <option value="gt">Greater than</option>
              <option value="lt">Less than</option>
              <option value="between">Between</option>
            </AppSelect>
            {amountOp !== 'any' && (
              <Input className="h-9 w-24 font-mono" placeholder="0.00" value={amountValue} onChange={e => setAmountValue(e.target.value)} />
            )}
            {amountOp === 'between' && (
              <Input className="h-9 w-24 font-mono" placeholder="0.00" value={amountValue2} onChange={e => setAmountValue2(e.target.value)} />
            )}
          </div>
        </div>
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
          tableSettingsPageId="transactions"
          availableFilters={[
            { key: 'date_range', label: 'Date range' },
            { key: 'transaction_type', label: 'Transaction type' },
            { key: 'ref_no', label: 'Reference number' },
            { key: 'contact', label: 'Contact' },
            { key: 'amount', label: 'Amount' },
            { key: 'memo', label: 'Memo' },
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
