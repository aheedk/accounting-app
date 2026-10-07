import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FileDown, Printer, X } from 'lucide-react';
import { downloadAsExcel } from '@/lib/download';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/input';
import { fmtMoney } from '@/lib/money';
import { fmtDateTime, daysAgoLocal } from '@/lib/dates';
import { pickErr } from '@/lib/apiErrors';
import { AppSelect } from '../../components/ui/select';

type Expense = {
  id: string;
  transaction_date: string;
  reference: string | null;
  memo: string | null;
  total_amount: string;
  payment_account_id: string;
  payment_account_name: string;
  payee_name: string | null;
  status: 'draft' | 'posted' | 'void';
  journal_entry_id: string | null;
  updated_at: string;
};

const DATE_RANGES = [
  { value: '30d', label: 'Last 30 days', days: 30 },
  { value: '3m', label: 'Last 3 months', days: 92 },
  { value: '12m', label: 'Last 12 months', days: 365 },
  { value: 'all', label: 'All dates', days: 0 },
] as const;

function fmtShortDate(iso: string) {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

const DASH = <span className="text-muted-foreground">—</span>;

const STATUS_PILL: Record<Expense['status'], string> = {
  draft: 'bg-muted text-muted-foreground',
  posted: 'bg-emerald-100 text-emerald-800',
  void: 'bg-red-100 text-red-800',
};

export default function ExpenseListPage() {
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const [items, setItems] = useState<Expense[]>([]);
  const [dateFilter, setDateFilter] = useState<string>('3m');
  const [accountFilter, setAccountFilter] = useState<string>('all');
  const [refSearch, setRefSearch] = useState('');
  const [amountFilter, setAmountFilter] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [excelBusy, setExcelBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!bizId) { setItems([]); return; }
    setErr(null);
    try {
      const r = await api.get<{ expense_transactions: Expense[] }>(`/businesses/${bizId}/expense-transactions`);
      setItems(Array.isArray(r.data.expense_transactions) ? r.data.expense_transactions : []);
    } catch (e: unknown) {
      setErr(pickErr(e));
    }
  }, [bizId]);

  useEffect(() => { void reload(); }, [reload]);

  const accounts = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of items) seen.set(e.payment_account_id, e.payment_account_name);
    return [...seen.entries()];
  }, [items]);

  const range = DATE_RANGES.find(r => r.value === dateFilter);
  const rows = useMemo(() => {
    const cutoff = range && range.days > 0 ? daysAgoLocal(range.days) : '';
    const ref = refSearch.trim().toLowerCase();
    const amount = parseFloat(amountFilter);
    return items
      .filter(e => !cutoff || e.transaction_date >= cutoff)
      .filter(e => accountFilter === 'all' || e.payment_account_id === accountFilter)
      .filter(e => !ref || (e.reference ?? '').toLowerCase().includes(ref))
      .filter(e => Number.isNaN(amount) || Math.abs(parseFloat(e.total_amount) - amount) < 0.005);
  }, [items, range, accountFilter, refSearch, amountFilter]);

  const columns: Column<Expense>[] = [
    { key: 'transaction_date', header: 'Date', sortable: true, sortValue: r => r.transaction_date, render: r => <span className="whitespace-nowrap">{fmtShortDate(r.transaction_date)}</span> },
    { key: 'type', header: 'Type', sortable: false, render: () => 'Expense' },
    { key: 'reference', header: 'Ref No.', sortable: true, sortValue: r => r.reference ?? '', render: r => r.reference ? <span className="font-mono">{r.reference}</span> : DASH },
    { key: 'payee_name', header: 'Payee', sortable: true, sortValue: r => r.payee_name ?? '', render: r => r.payee_name ?? DASH },
    { key: 'payment_account_name', header: 'Payment Account', sortable: true, sortValue: r => r.payment_account_name, render: r => r.payment_account_name },
    { key: 'total_amount', header: 'Total Amount', align: 'right', sortable: true, sortValue: r => Number(r.total_amount), render: r => <span className="font-mono">{fmtMoney(r.total_amount)}</span> },
    { key: 'memo', header: 'Memo', sortable: true, sortValue: r => r.memo ?? '', render: r => r.memo || DASH },
    { key: 'updated_at', header: 'Last Modified', sortable: true, sortValue: r => r.updated_at, render: r => <span className="whitespace-nowrap text-muted-foreground">{fmtDateTime(r.updated_at)}</span> },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      sortValue: r => r.status,
      render: r => <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_PILL[r.status]}`}>{r.status}</span>,
    },
  ];

  const dlHeaders = columns.map(c => c.header);
  const dlRows = () => rows.map(row => columns.map(col => col.sortValue ? String(col.sortValue(row)) : ''));

  function handleExport() {
    setExcelBusy(true);
    try { downloadAsExcel(dlHeaders, dlRows(), 'expense-transactions'); } finally { setExcelBusy(false); }
  }

  function handlePrint() {
    const rowsHtml = dlRows().map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>Expense Transactions</title><style>body{font-family:Arial,sans-serif;font-size:11px;margin:24px}h2{margin-bottom:4px}p{color:#666;font-size:10px;margin-bottom:16px}table{width:100%;border-collapse:collapse}th{background:#f0f0f0;text-align:left;padding:5px 7px;border-bottom:2px solid #ccc;font-size:10px;text-transform:uppercase}td{padding:4px 7px;border-bottom:1px solid #e5e5e5}</style></head><body><h2>Expense Transactions</h2><p>Generated ${new Date().toLocaleDateString()}</p><table><thead><tr>${dlHeaders.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rowsHtml}</tbody></table><script>window.onload=function(){window.print()}</script></body></html>`);
    win.document.close();
  }

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Expense Transactions</h1>
        <div className="flex items-center gap-2">
          <div className="relative group">
            <button className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50" onClick={handleExport} disabled={excelBusy} aria-label="Export to Excel">
              <FileDown className="h-4 w-4" />
            </button>
            <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">Export to Excel</div>
          </div>
          <div className="relative group">
            <button className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground" onClick={handlePrint} aria-label="Print">
              <Printer className="h-4 w-4" />
            </button>
            <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">Print</div>
          </div>
          <Button asChild><Link to="/accounting/expenses/new">New expense</Link></Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Date range</label>
          <AppSelect className="h-9 w-40 rounded-md border bg-background px-3 text-sm" value={dateFilter} onChange={e => setDateFilter(e.target.value)}>
            {DATE_RANGES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </AppSelect>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Transaction type</label>
          <AppSelect className="h-9 w-36 rounded-md border bg-background px-3 text-sm" value="expense" disabled onChange={() => {}}>
            <option value="expense">Expense</option>
          </AppSelect>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Ref number</label>
          <Input className="h-9 w-36" placeholder="Search…" value={refSearch} onChange={e => setRefSearch(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Account</label>
          <AppSelect className="h-9 w-44 rounded-md border bg-background px-3 text-sm" value={accountFilter} onChange={e => setAccountFilter(e.target.value)}>
            <option value="all">All accounts</option>
            {accounts.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </AppSelect>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Amount</label>
          <Input className="h-9 w-32 font-mono" placeholder="0.00" value={amountFilter} onChange={e => setAmountFilter(e.target.value)} />
        </div>
      </div>

      {/* Pre-filtered shortcut onto the unified Transactions view — clearing
          the chip goes there rather than showing "all types" on this page. */}
      <span className="inline-flex h-8 items-center gap-2 rounded-full border bg-muted/40 px-3 text-sm">
        Transaction type: <span className="font-medium">Expense</span>
        <button type="button" onClick={() => nav('/accounting/transactions')} aria-label="Clear transaction type filter">
          <X className="h-3.5 w-3.5 text-muted-foreground/70 hover:text-foreground" />
        </button>
      </span>

      {err && <p className="text-sm text-destructive">{err}</p>}

      <Card><CardContent className="p-0">
        <DataTable
          rows={rows}
          getRowId={r => r.id}
          columns={columns}
          defaultSortKey="transaction_date"
          defaultSortDir="desc"
          pagination={{ pageSize: 25 }}
          selectable={false}
          tableSettingsPageId="expense-transactions"
          onRowClick={r => nav(`/accounting/expenses/${r.id}`)}
          emptyMessage={<EmptyState title="No expenses found" hint="Adjust the filters above, or record an expense." actionLabel="New expense" actionTo="/accounting/expenses/new" />}
        />
      </CardContent></Card>
    </div>
  );
}
