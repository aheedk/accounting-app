import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, FileDown, Printer, Settings } from 'lucide-react';
import { downloadAsExcel } from '@/lib/download';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { MoneyBar } from '@/components/ui/MoneyBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { fmtMoney } from '@/lib/money';
import { AppSelect } from '../../components/ui/select';
import { printReport } from '@/lib/reportExport';

type FixedAssetStatus = 'active' | 'disposed';

type FixedAssetRow = {
  id: string;
  name: string;
  cost: string;
  salvage_value: string;
  useful_life_years: number;
  purchase_date: string;
  status: FixedAssetStatus;
  accumulated_depreciation: string;
  book_value: string;
};

type ListResponse = { fixed_assets: FixedAssetRow[]; ledger_cost_total?: string };

function fmtShortDate(iso: string) {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

function statusBadge(status: FixedAssetStatus) {
  const base = 'inline-flex rounded-full px-2 py-0.5 text-xs font-medium';
  return status === 'active'
    ? <span className={`${base} bg-emerald-100 text-emerald-800`}>Active</span>
    : <span className={`${base} bg-muted text-muted-foreground`}>Disposed</span>;
}

export default function FixedAssetListPage() {
  const [bizId] = useActiveBusinessId();
  const [items, setItems] = useState<FixedAssetRow[]>([]);
  const [excelBusy, setExcelBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  // What the ledger holds in the asset accounts; the register is kept separately from it.
  const [ledgerCost, setLedgerCost] = useState<string | null>(null);

  useEffect(() => {
    if (!bizId) return;
    setLoading(true);
    setErr(null);
    api
      .get<ListResponse>(`/businesses/${bizId}/fixed-assets`)
      .then((r) => { setItems(r.data.fixed_assets); setLedgerCost(r.data.ledger_cost_total ?? null); })
      .catch((e: unknown) => {
        const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
        setErr(msg ?? 'Failed to load fixed assets');
      })
      .finally(() => setLoading(false));
  }, [bizId]);

  const filtered = statusFilter ? items.filter(a => a.status === statusFilter) : items;
  const activeCost = items.filter(a => a.status === 'active').reduce((sum, a) => sum + Number(a.cost), 0);

  // Totals span all assets, unfiltered (QBO behavior).
  const totals = useMemo(() => items.reduce(
    (acc, a) => ({
      cost: acc.cost + Number(a.cost),
      accumulated: acc.accumulated + Number(a.accumulated_depreciation),
      book: acc.book + Number(a.book_value),
    }),
    { cost: 0, accumulated: 0, book: 0 },
  ), [items]);

  const columns: Column<FixedAssetRow>[] = [
    { key: 'name', header: 'Name', sortable: true, sortValue: r => r.name, render: r => <span className="font-medium">{r.name}</span> },
    { key: 'purchase_date', header: 'Purchase Date', sortable: true, sortValue: r => Date.parse(r.purchase_date), render: r => <span className="whitespace-nowrap">{fmtShortDate(r.purchase_date)}</span> },
    { key: 'cost', header: 'Cost', sortable: true, align: 'right', sortValue: r => Number(r.cost), render: r => <span className="font-mono">{fmtMoney(r.cost)}</span> },
    { key: 'salvage_value', header: 'Salvage', sortable: true, align: 'right', sortValue: r => Number(r.salvage_value), render: r => <span className="font-mono">{fmtMoney(r.salvage_value)}</span> },
    { key: 'useful_life_years', header: 'Life (yrs)', sortable: true, align: 'right', sortValue: r => r.useful_life_years, render: r => r.useful_life_years },
    { key: 'accumulated_depreciation', header: 'Accum. Dep.', sortable: true, align: 'right', sortValue: r => Number(r.accumulated_depreciation), render: r => <span className="font-mono">{fmtMoney(r.accumulated_depreciation)}</span> },
    { key: 'book_value', header: 'Book Value', sortable: true, align: 'right', sortValue: r => Number(r.book_value), render: r => <span className="font-mono">{fmtMoney(r.book_value)}</span> },
    { key: 'status', header: 'Status', sortable: true, sortValue: r => r.status, render: r => statusBadge(r.status) },
  ];

  if (!bizId) return <div>Pick a business.</div>;

  const dlHeaders = columns.map(c => c.header);
  const dlRows = () => items.map(row => columns.map(col => col.sortValue ? String(col.sortValue(row)) : ''));

  function handleExport() {
    setExcelBusy(true);
    try { downloadAsExcel(dlHeaders, dlRows(), 'fixed-assets', { title: 'Fixed Assets' }); } finally { setExcelBusy(false); }
  }

  function handlePrint() {
    printReport({ title: 'Fixed Assets', headers: dlHeaders, rows: dlRows() });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Fixed Assets</h1>
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
          <Button asChild>
            <Link to="/accounting/fixed-assets/new">Add fixed asset</Link>
          </Button>
        </div>
      </div>

      {items.length > 0 && (
        <MoneyBar
          segments={[
            { amount: totals.cost, caption: 'Total cost', colorClass: 'bg-sky-500' },
            { amount: totals.accumulated, caption: 'Accumulated depreciation', colorClass: 'bg-amber-500' },
            { amount: totals.book, caption: 'Net book value', colorClass: 'bg-emerald-500' },
          ]}
        />
      )}

      {ledgerCost !== null && Math.abs(activeCost - Number(ledgerCost)) >= 0.01 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          The register and the ledger disagree. Active assets here cost <span className="font-mono">{fmtMoney(activeCost)}</span>,
          but their asset accounts hold <span className="font-mono">{fmtMoney(ledgerCost)}</span> in the ledger, a difference
          of <span className="font-mono">{fmtMoney(Math.abs(activeCost - Number(ledgerCost)))}</span>. Usually a purchase entry was
          changed in the journal, or something was bought and not added here.
        </div>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <div className="mb-1 text-xs text-muted-foreground">Status</div>
          <AppSelect className="h-9 rounded-md border bg-background px-3 text-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="disposed">Disposed</option>
          </AppSelect>
        </div>
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : (
            <DataTable
              rows={filtered}
              getRowId={r => r.id}
              columns={columns}
              defaultSortKey="purchase_date"
              defaultSortDir="desc"
              downloadable={{ filename: 'fixed-assets', title: 'Fixed Assets' }}
              actionsHeader={<span className="inline-flex items-center gap-1.5">Action <Settings className="h-3.5 w-3.5" /></span>}
              actions={r => (
                <span className="inline-flex items-center gap-2">
                  <Link className="text-primary hover:underline" to={`/accounting/fixed-assets/${r.id}`}>View/Edit</Link>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </span>
              )}
              emptyMessage={<EmptyState title="No fixed assets found" hint="Add an asset to track its cost, depreciation, and book value." actionLabel="Add fixed asset" actionTo="/accounting/fixed-assets/new" />}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
