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

type Deposit = {
  id: string;
  deposit_date: string;
  deposit_number: string;
  memo: string | null;
  total_amount: string;
  bank_account_id: string;
  bank_account_name: string;
  journal_entry_id: string | null;
  created_at: string;
  line_count: string;
  first_received_from: string | null;
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

export default function BankDepositListPage() {
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const [items, setItems] = useState<Deposit[]>([]);
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
      const r = await api.get<Deposit[]>(`/businesses/${bizId}/bank-deposits`);
      setItems(Array.isArray(r.data) ? r.data : []);
    } catch (e: unknown) {
      setErr(pickErr(e));
    }
  }, [bizId]);

  useEffect(() => { void reload(); }, [reload]);

  const bankAccounts = useMemo(() => {
    const seen = new Map<string, string>();
    for (const d of items) seen.set(d.bank_account_id, d.bank_account_name);
    return [...seen.entries()];
  }, [items]);

  const range = DATE_RANGES.find(r => r.value === dateFilter);
  const rows = useMemo(() => {
    const cutoff = range && range.days > 0 ? daysAgoLocal(range.days) : '';
    const ref = refSearch.trim().toLowerCase();
    const amount = parseFloat(amountFilter);
    return items
      .filter(d => !cutoff || d.deposit_date >= cutoff)
      .filter(d => accountFilter === 'all' || d.bank_account_id === accountFilter)
      .filter(d => !ref || d.deposit_number.toLowerCase().includes(ref))
      .filter(d => Number.isNaN(amount) || Math.abs(parseFloat(d.total_amount) - amount) < 0.005);
  }, [items, range, accountFilter, refSearch, amountFilter]);

  // Columns mirror the QBO transaction-search layout. CONTACT / DUE DATE / BALANCE
  // are always blank for deposits there too (they're columns the shared page needs
  // for invoices and bills, not deposits) — kept here only for visual parity, not
  // backed by real deposit data since bank_deposits has no per-header contact.
  const columns: Column<Deposit>[] = [
    { key: 'deposit_date', header: 'Date', sortable: true, sortValue: r => r.deposit_date, render: r => <span className="whitespace-nowrap">{fmtShortDate(r.deposit_date)}</span> },
    { key: 'type', header: 'Type', sortable: false, render: () => 'Deposit' },
    { key: 'deposit_number', header: 'Ref No.', sortable: true, sortValue: r => r.deposit_number, render: r => <span className="font-mono">{r.deposit_number}</span> },
    { key: 'bank_account_name', header: 'Account', sortable: true, sortValue: r => r.bank_account_name, render: r => r.bank_account_name },
    {
      key: 'contact',
      header: 'Contact',
      sortable: false,
      // A single-line deposit shows that line's "received from"; a multi-line
      // one shows "Multiple" (there's no one contact to name) — QBO leaves
      // deposits blank here regardless, but line_count gives us more to show.
      render: r => {
        const count = parseInt(r.line_count, 10);
        if (count > 1) return <span className="text-muted-foreground">Multiple</span>;
        return r.first_received_from || DASH;
      },
    },
    { key: 'due_date', header: 'Due Date', sortable: false, render: () => DASH },
    { key: 'balance', header: 'Balance', align: 'right', sortable: false, render: () => <span className="font-mono text-muted-foreground">{fmtMoney('0')}</span> },
    { key: 'total_amount', header: 'Total Amount', align: 'right', sortable: true, sortValue: r => Number(r.total_amount), render: r => <span className="font-mono">{fmtMoney(r.total_amount)}</span> },
    { key: 'memo', header: 'Memo', sortable: true, sortValue: r => r.memo ?? '', render: r => r.memo || DASH },
    { key: 'created_at', header: 'Last Modified', sortable: true, sortValue: r => r.created_at, render: r => <span className="whitespace-nowrap text-muted-foreground">{fmtDateTime(r.created_at)}</span> },
  ];

  const dlHeaders = columns.map(c => c.header);
  const dlRows = () => rows.map(row => columns.map(col => col.sortValue ? String(col.sortValue(row)) : ''));

  function handleExport() {
    setExcelBusy(true);
    try { downloadAsExcel(dlHeaders, dlRows(), 'bank-deposits'); } finally { setExcelBusy(false); }
  }

  function handlePrint() {
    const rowsHtml = dlRows().map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>Bank Deposits</title><style>body{font-family:Arial,sans-serif;font-size:11px;margin:24px}h2{margin-bottom:4px}p{color:#666;font-size:10px;margin-bottom:16px}table{width:100%;border-collapse:collapse}th{background:#f0f0f0;text-align:left;padding:5px 7px;border-bottom:2px solid #ccc;font-size:10px;text-transform:uppercase}td{padding:4px 7px;border-bottom:1px solid #e5e5e5}</style></head><body><h2>Bank Deposits</h2><p>Generated ${new Date().toLocaleDateString()}</p><table><thead><tr>${dlHeaders.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rowsHtml}</tbody></table><script>window.onload=function(){window.print()}</script></body></html>`);
    win.document.close();
  }

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Bank Deposits</h1>
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
          <Button asChild><Link to="/accounting/bank-deposits/new">New deposit</Link></Button>
        </div>
      </div>

      {/* Filter bar, laid out like QBO's transaction search: date range, locked
          transaction type, reference search, account, amount. */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Date range</label>
          <AppSelect className="h-9 w-40 rounded-md border bg-background px-3 text-sm" value={dateFilter} onChange={e => setDateFilter(e.target.value)}>
            {DATE_RANGES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </AppSelect>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Transaction type</label>
          <AppSelect className="h-9 w-36 rounded-md border bg-background px-3 text-sm" value="deposit" disabled onChange={() => {}}>
            <option value="deposit">Deposit</option>
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
            {bankAccounts.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
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
        Transaction type: <span className="font-medium">Deposit</span>
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
          defaultSortKey="deposit_date"
          defaultSortDir="desc"
          pagination={{ pageSize: 25 }}
          selectable={false}
          tableSettingsPageId="bank-deposits"
          onRowClick={r => nav(`/accounting/bank-deposits/${r.id}`)}
          emptyMessage={<EmptyState title="No deposits found" hint="Adjust the filters above, or record a bank deposit." actionLabel="New deposit" actionTo="/accounting/bank-deposits/new" />}
        />
      </CardContent></Card>
    </div>
  );
}
