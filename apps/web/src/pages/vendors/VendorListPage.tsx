import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { hasMinRole } from '@accounting/shared';
import { ChevronDown, FileDown, Printer, Settings } from 'lucide-react';
import { downloadAsExcel } from '@/lib/download';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { MoneyBar } from '@/components/ui/MoneyBar';
import { fmtMoney } from '@/lib/money';
import { UploadExcelButton } from '@/components/ui/UploadExcelButton';
import { daysAgoLocal, todayLocal } from '@/lib/dates';
import { EmptyState } from '@/components/ui/EmptyState';
import { printReport } from '@/lib/reportExport';
import { pickErr } from '@/lib/apiErrors';

const IMPORT_COLS = [
  { key: 'name', header: 'Name', required: true },
  { key: 'email', header: 'Email' },
  { key: 'phone', header: 'Phone' },
  { key: 'default_terms_days', header: 'Terms Days' },
];

type Vendor = {
  id: string; name: string; email: string | null; phone: string | null;
  default_terms_days: number; is_1099: boolean; is_active: boolean; has_transactions: boolean;
};
type Bill = { id: string; vendor_id: string; bill_date: string; due_date: string; status: string; total: string };

export default function VendorListPage() {
  const [bizId] = useActiveBusinessId();
  const { user, businesses } = useAuth();
  const role = businesses.find(b => b.id === bizId)?.role_override ?? user?.role;
  const canMakeInactive = role !== undefined && hasMinRole(role, 'accountant');

  const [items, setItems] = useState<Vendor[]>([]);
  const [excelBusy, setExcelBusy] = useState(false);
  const [bills, setBills] = useState<Bill[]>([]);
  const [showInactive, setShowInactive] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [openActionRow, setOpenActionRow] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function reload() {
    if (!bizId) return;
    const r = await api.get(`/businesses/${bizId}/vendors`, {
      params: showInactive ? { include_inactive: 'true' } : {},
    });
    setItems(r.data.vendors);
  }
  useEffect(() => { reload(); }, [bizId, showInactive]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (bizId) api.get(`/businesses/${bizId}/bills`, { params: { limit: 1000 } }).then(r => setBills(r.data.bills)); }, [bizId]);

  const today = todayLocal();
  const yearAgo = daysAgoLocal(365);

  // QBO vendors page: "Unpaid Last 365 Days" bar — overdue / open bills / paid.
  const stats = useMemo(() => {
    let overdue = 0, overdueCount = 0, open = 0, openCount = 0, paid = 0, paidCount = 0;
    for (const b of bills) {
      if (b.bill_date < yearAgo) continue;
      const amt = Number(b.total);
      if (b.status === 'posted') {
        if (b.due_date < today) { overdue += amt; overdueCount += 1; }
        else { open += amt; openCount += 1; }
      } else if (b.status === 'paid') { paid += amt; paidCount += 1; }
    }
    return { overdue, overdueCount, open, openCount, paid, paidCount };
  }, [bills, today, yearAgo]);

  const openBalanceByVendor = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of bills) {
      if (b.status !== 'posted') continue;
      m.set(b.vendor_id, (m.get(b.vendor_id) ?? 0) + Number(b.total));
    }
    return m;
  }, [bills]);

  type Row = Vendor & { open_balance: number };
  const rows: Row[] = useMemo(
    () => items.map(v => ({ ...v, open_balance: openBalanceByVendor.get(v.id) ?? 0 })),
    [items, openBalanceByVendor],
  );

  const columns: Column<Row>[] = [
    {
      key: 'name',
      header: 'Vendor',
      sortable: true,
      sortValue: r => r.name,
      render: r => (
        <span className="inline-flex items-center gap-2">
          <Link className="font-medium hover:underline" to={`/ap/vendors/${r.id}`}>{r.name}</Link>
          {!r.is_active && <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Inactive</span>}
        </span>
      ),
    },
    { key: 'phone', header: 'Phone', render: r => <span className="whitespace-nowrap">{r.phone || <span className="text-muted-foreground">—</span>}</span> },
    { key: 'email', header: 'Email', sortable: true, sortValue: r => r.email ?? '', render: r => r.email || <span className="text-muted-foreground">—</span> },
    {
      key: 'is_1099',
      header: '1099 tracking',
      sortable: true,
      sortValue: r => (r.is_1099 ? 1 : 0),
      render: r => r.is_1099
        ? <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">Yes</span>
        : <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">No</span>,
    },
    { key: 'open_balance', header: 'Open balance', sortable: true, align: 'right', sortValue: r => r.open_balance, render: r => <span className="font-mono">{fmtMoney(String(r.open_balance))}</span> },
  ];

  async function importRow(row: Record<string, string>) {
    await api.post(`/businesses/${bizId}/vendors`, {
      name: row['name'],
      email: row['email'] || null,
      phone: row['phone'] || null,
      default_terms_days: row['default_terms_days'] ? parseInt(row['default_terms_days'], 10) : undefined,
    });
  }

  async function makeInactive(ids: string[]) {
    if (!bizId) return;
    const noun = ids.length === 1 ? 'vendor' : `${ids.length} vendors`;
    if (!window.confirm(`Make ${noun} inactive? They will be hidden from dropdowns but their transaction history will be preserved.`)) return;
    setErr(null);
    setBatchBusy(true);
    try {
      await Promise.all(ids.map(id => api.patch(`/businesses/${bizId}/vendors/${id}`, { is_active: false })));
      setSelectedIds(new Set());
      await reload();
    } catch (e: unknown) { setErr(pickErr(e)); }
    finally { setBatchBusy(false); }
  }

  if (!bizId) return <div>Pick a business.</div>;

  const dlHeaders = columns.map(c => c.header);
  const dlRows = () => rows.map(row => columns.map(col => col.sortValue ? String(col.sortValue(row)) : ''));

  function handleExport() {
    setExcelBusy(true);
    try { downloadAsExcel(dlHeaders, dlRows(), 'vendors', { title: 'Vendors' }); } finally { setExcelBusy(false); }
  }

  function handlePrint() {
    printReport({ title: 'Vendors', headers: dlHeaders, rows: dlRows() });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Vendors</h1>
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
          <UploadExcelButton columns={IMPORT_COLS} entityName="Vendors" onImportRow={importRow} onDone={reload} />
          <Button asChild variant="outline"><Link to="/ap/bill-payments/new">Pay vendors</Link></Button>
          <Button asChild><Link to="/ap/vendors/new">New vendor</Link></Button>
        </div>
      </div>

      <div>
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Unpaid last 365 days</div>
        <MoneyBar segments={[
          { amount: stats.overdue, caption: `${stats.overdueCount} overdue`, colorClass: 'bg-orange-400' },
          { amount: stats.open, caption: `${stats.openCount} open bill${stats.openCount === 1 ? '' : 's'}`, colorClass: 'bg-gray-300' },
          { amount: stats.paid, caption: `${stats.paidCount} paid last 365 days`, colorClass: 'bg-green-600' },
        ]} />
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={showInactive} onChange={e => { setShowInactive(e.target.checked); setSelectedIds(new Set()); }} />
          Show inactive vendors
        </label>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-md bg-gray-900 px-4 py-2.5 text-sm text-white">
          <span className="font-medium">{selectedIds.size} vendor{selectedIds.size === 1 ? '' : 's'} selected</span>
          <div className="relative">
            <button
              type="button"
              onClick={() => setBatchOpen(current => !current)}
              disabled={batchBusy}
              className="inline-flex items-center gap-1 rounded-md border border-white/30 px-3 py-1.5 text-sm hover:bg-white/10 disabled:opacity-50"
            >
              Batch actions <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {batchOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setBatchOpen(false)} />
                <div className="absolute top-full left-0 z-50 mt-1 w-48 rounded-md border bg-white text-foreground shadow-lg dark:bg-zinc-900">
                  <button
                    type="button"
                    onClick={() => { setBatchOpen(false); alert('Email — coming soon'); }}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                  >
                    Email
                  </button>
                  <button
                    type="button"
                    disabled={!canMakeInactive}
                    onClick={() => { setBatchOpen(false); void makeInactive([...selectedIds]); }}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                    title={canMakeInactive ? undefined : 'Accountant access is required'}
                  >
                    Make inactive
                  </button>
                </div>
              </>
            )}
          </div>
          <button type="button" onClick={() => setSelectedIds(new Set())} className="ml-auto text-white/70 hover:text-white" aria-label="Clear selection">
            ×
          </button>
        </div>
      )}

      <Card><CardContent className="p-0">
        <DataTable
          rows={rows}
          getRowId={r => r.id}
          columns={columns}
          defaultSortKey="name"
          defaultSortDir="asc"
          selectedIds={selectedIds}
          onSelectedIdsChange={setSelectedIds}
          actionsHeader={<span className="inline-flex items-center gap-1.5">Action <Settings className="h-3.5 w-3.5" /></span>}
          actions={r => (
            <span className="relative inline-flex items-center gap-2">
              <Link className="text-primary hover:underline" to={`/ap/bills/new?vendor_id=${r.id}`}>Create bill</Link>
              <button
                type="button"
                onClick={() => setOpenActionRow(current => (current === r.id ? null : r.id))}
                aria-label={`More actions for ${r.name}`}
              >
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </button>
              {openActionRow === r.id && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setOpenActionRow(null)} />
                  <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-md border bg-white text-left shadow-lg dark:bg-zinc-900">
                    <Link
                      to={`/accounting/expenses/new?vendor_id=${r.id}`}
                      onClick={() => setOpenActionRow(null)}
                      className="block w-full px-3 py-2 text-sm hover:bg-accent"
                    >
                      Create Expense
                    </Link>
                    <Link
                      to={`/accounting/checks/new?vendorId=${r.id}`}
                      onClick={() => setOpenActionRow(null)}
                      className="block w-full px-3 py-2 text-sm hover:bg-accent"
                    >
                      Write check
                    </Link>
                    <button
                      type="button"
                      disabled={!canMakeInactive || !r.is_active}
                      onClick={() => { setOpenActionRow(null); void makeInactive([r.id]); }}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                      title={!canMakeInactive ? 'Accountant access is required' : !r.is_active ? 'Already inactive' : undefined}
                    >
                      Make inactive
                    </button>
                    <button
                      type="button"
                      onClick={() => { setOpenActionRow(null); alert('Vendor info request coming soon.'); }}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                    >
                      Ask vendor for info
                    </button>
                  </div>
                </>
              )}
            </span>
          )}
          emptyMessage={<EmptyState title="No vendors yet" hint="Add a vendor to start tracking bills and expenses." actionLabel="New vendor" actionTo="/ap/vendors/new" />}
        />
      </CardContent></Card>
    </div>
  );
}
