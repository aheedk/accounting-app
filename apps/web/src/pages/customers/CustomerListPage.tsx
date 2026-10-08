import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, FileDown, Printer } from 'lucide-react';
import { downloadAsExcel } from '@/lib/download';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { fmtMoney } from '@/lib/money';
import { UploadExcelButton } from '@/components/ui/UploadExcelButton';
import { EmptyState } from '@/components/ui/EmptyState';
import { printReport } from '@/lib/reportExport';
import { pickErr } from '@/lib/apiErrors';
import { flashMessage } from '@/lib/flash';
import { mailtoLink } from '@/lib/mailto';
import { useCan } from '@/lib/roleAccess';

const IMPORT_COLS = [
  { key: 'name', header: 'Name', required: true },
  { key: 'company_name', header: 'Company Name' },
  { key: 'email', header: 'Email' },
  { key: 'phone', header: 'Phone' },
  { key: 'default_terms_days', header: 'Terms Days' },
];

type Customer = {
  id: string;
  name: string;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  default_terms_days: number;
  open_balance: string | null;
  is_active: boolean;
  // Anything ever recorded for them. Such a customer is made inactive, not deleted.
  has_transactions: boolean;
};

export default function CustomerListPage() {
  const [bizId] = useActiveBusinessId();
  const [items, setItems] = useState<Customer[]>([]);
  const [excelBusy, setExcelBusy] = useState(false);
  // The same batch actions, inactive switch and delete rule as Vendors.
  const can = useCan();
  const [showInactive, setShowInactive] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [openActionRow, setOpenActionRow] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function reload() {
    if (!bizId) return;
    const r = await api.get(`/businesses/${bizId}/customers`, { params: showInactive ? { include_inactive: 'true' } : {} });
    setItems(r.data.customers);
  }

  useEffect(() => { reload(); }, [bizId, showInactive]); // eslint-disable-line react-hooks/exhaustive-deps

  // No mail service yet, so this starts a message in the user's own mail program.
  function emailSelected() {
    const addresses = items.filter(c => selectedIds.has(c.id) && c.email).map(c => c.email!);
    if (addresses.length === 0) { flashMessage('None of the selected customers has an email address.'); return; }
    const skipped = selectedIds.size - addresses.length;
    if (skipped > 0) flashMessage(`${skipped} selected customer${skipped === 1 ? ' has' : 's have'} no email address and ${skipped === 1 ? 'was' : 'were'} left out.`, 4000);
    window.location.href = mailtoLink({ bcc: addresses });
  }

  async function setActive(ids: string[], active: boolean) {
    if (!bizId) return;
    const noun = ids.length === 1 ? 'customer' : `${ids.length} customers`;
    if (!active && !window.confirm(`Make ${noun} inactive? They will be hidden from dropdowns but their transaction history will be preserved.`)) return;
    setErr(null); setBatchBusy(true);
    try {
      await Promise.all(ids.map(id => api.patch(`/businesses/${bizId}/customers/${id}`, { is_active: active })));
      setSelectedIds(new Set());
      await reload();
    } catch (e: unknown) { setErr(pickErr(e)); }
    finally { setBatchBusy(false); }
  }

  async function deleteCustomer(c: Customer) {
    if (!bizId || !window.confirm(`Delete ${c.name}? This cannot be undone.`)) return;
    setErr(null);
    try { await api.delete(`/businesses/${bizId}/customers/${c.id}`); await reload(); }
    catch (e: unknown) { setErr(pickErr(e)); }
  }

  const columns: Column<Customer>[] = [
    { key: 'name', header: 'Name', sortable: true, sortValue: r => r.name, render: r => <span><Link className="font-medium hover:underline" to={`/customers/${r.id}`}>{r.name}</Link>{!r.is_active && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Inactive</span>}</span> },
    { key: 'company_name', header: 'Company name', sortable: true, sortValue: r => r.company_name ?? '', render: r => r.company_name || <span className="text-muted-foreground">—</span> },
    { key: 'phone', header: 'Phone', render: r => <span className="whitespace-nowrap">{r.phone || <span className="text-muted-foreground">—</span>}</span> },
    { key: 'open_balance', header: 'Open balance', sortable: true, align: 'right', sortValue: r => Number(r.open_balance ?? 0), render: r => <span className="font-mono">{fmtMoney((r.open_balance ?? '0').toString())}</span> },
  ];

  async function importRow(row: Record<string, string>) {
    await api.post(`/businesses/${bizId}/customers`, {
      name: row['name'],
      company_name: row['company_name'] || null,
      email: row['email'] || null,
      phone: row['phone'] || null,
      default_terms_days: row['default_terms_days'] ? parseInt(row['default_terms_days'], 10) : undefined,
    });
  }

  if (!bizId) return <div>Pick a business.</div>;

  const dlHeaders = columns.map(c => c.header);
  const dlRows = () => items.map(row => columns.map(col => col.sortValue ? String(col.sortValue(row)) : ''));

  function handleExport() {
    setExcelBusy(true);
    try { downloadAsExcel(dlHeaders, dlRows(), 'customers', { title: 'Customers' }); } finally { setExcelBusy(false); }
  }

  function handlePrint() {
    printReport({ title: 'Customers', headers: dlHeaders, rows: dlRows() });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Customers</h1>
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
          <UploadExcelButton columns={IMPORT_COLS} entityName="Customers" onImportRow={importRow} onDone={reload} />
          <Button asChild><Link to="/customers/new">New customer</Link></Button>
        </div>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}

      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input type="checkbox" checked={showInactive} onChange={e => { setShowInactive(e.target.checked); setSelectedIds(new Set()); }} />
        Show inactive customers
      </label>

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-md bg-gray-900 px-4 py-2.5 text-sm text-white">
          <span className="font-medium">{selectedIds.size} customer{selectedIds.size === 1 ? '' : 's'} selected</span>
          <div className="relative">
            <button type="button" onClick={() => setBatchOpen(current => !current)} disabled={batchBusy}
              className="inline-flex items-center gap-1 rounded-md border border-white/30 px-3 py-1.5 text-sm hover:bg-white/10 disabled:opacity-50">
              Batch actions <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {batchOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setBatchOpen(false)} />
                <div className="absolute top-full left-0 z-50 mt-1 w-48 rounded-md border bg-white text-foreground shadow-lg dark:bg-zinc-900">
                  <button type="button" onClick={() => { setBatchOpen(false); emailSelected(); }} className="block w-full px-3 py-2 text-left text-sm hover:bg-accent">Email</button>
                  <button type="button" disabled={!can.accountant} title={can.accountant ? undefined : 'Accountant access is required'}
                    onClick={() => { setBatchOpen(false); void setActive([...selectedIds], false); }}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40">
                    Make inactive
                  </button>
                </div>
              </>
            )}
          </div>
          <button type="button" onClick={() => setSelectedIds(new Set())} className="ml-auto text-white/70 hover:text-white" aria-label="Clear selection">×</button>
        </div>
      )}

      <Card><CardContent className="p-0">
        <DataTable
          rows={items}
          getRowId={r => r.id}
          columns={columns}
          defaultSortKey="name"
          defaultSortDir="asc"
          selectedIds={selectedIds}
          onSelectedIdsChange={setSelectedIds}
          tableSettingsPageId="customers"
          actions={r => {
            const hasBalance = Number(r.open_balance ?? 0) > 0;
            return (
              <span className="relative inline-flex items-center gap-2">
                {hasBalance
                  ? <Link className="text-primary hover:underline" to={`/payments/new?customer_id=${r.id}`}>Receive payment</Link>
                  : <Link className="text-primary hover:underline" to={`/invoices/new?customer_id=${r.id}`}>Create invoice</Link>}
                <button type="button" onClick={() => setOpenActionRow(current => (current === r.id ? null : r.id))} aria-label={`More actions for ${r.name}`}>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </button>
                {openActionRow === r.id && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setOpenActionRow(null)} />
                    <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-md border bg-white text-left shadow-lg dark:bg-zinc-900">
                      <Link to={`/reports/customer-statement`} onClick={() => setOpenActionRow(null)} className="block w-full px-3 py-2 text-sm hover:bg-accent">Create statement</Link>
                      <button type="button" disabled={!can.accountant} title={can.accountant ? undefined : 'Accountant access is required'}
                        onClick={() => { setOpenActionRow(null); void setActive([r.id], !r.is_active); }}
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40">
                        {r.is_active ? 'Make inactive' : 'Make active'}
                      </button>
                      <button type="button" disabled={!can.admin || r.has_transactions}
                        title={r.has_transactions ? 'Has transactions. Make inactive instead.' : !can.admin ? 'Only a firm admin can delete' : undefined}
                        onClick={() => { setOpenActionRow(null); void deleteCustomer(r); }}
                        className="block w-full px-3 py-2 text-left text-sm text-destructive hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40">
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </span>
            );
          }}
          emptyMessage={<EmptyState title="No customers yet" hint="Add your first customer to start invoicing." actionLabel="New customer" actionTo="/customers/new" />}
        />
      </CardContent></Card>
    </div>
  );
}
