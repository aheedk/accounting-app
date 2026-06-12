import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Settings } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { MoneyBar } from '@/components/ui/MoneyBar';
import { fmtMoney } from '@/lib/money';
import { UploadExcelButton } from '@/components/ui/UploadExcelButton';
import { todayLocal } from '@/lib/dates';
import { EmptyState } from '@/components/ui/EmptyState';

const IMPORT_COLS = [
  { key: 'name', header: 'Name', required: true },
  { key: 'email', header: 'Email' },
  { key: 'phone', header: 'Phone' },
  { key: 'default_terms_days', header: 'Terms Days' },
];

type Vendor = { id: string; name: string; email: string | null; phone: string | null; default_terms_days: number; is_1099: boolean };
type Bill = { id: string; vendor_id: string; bill_date: string; due_date: string; status: string; total: string };

export default function VendorListPage() {
  const [bizId] = useActiveBusinessId();
  const [items, setItems] = useState<Vendor[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);

  async function reload() {
    if (!bizId) return;
    const r = await api.get(`/businesses/${bizId}/vendors`);
    setItems(r.data.vendors);
  }
  useEffect(() => { reload(); }, [bizId]);
  useEffect(() => { if (bizId) api.get(`/businesses/${bizId}/bills`, { params: { limit: 1000 } }).then(r => setBills(r.data.bills)); }, [bizId]);

  const today = todayLocal();
  const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);

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
    { key: 'name', header: 'Vendor', sortable: true, sortValue: r => r.name, render: r => <Link className="font-medium hover:underline" to={`/ap/vendors/${r.id}`}>{r.name}</Link> },
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

  if (!bizId) return <div>Pick a business.</div>;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Vendors</h1>
        <div className="flex items-center gap-2">
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

      <Card><CardContent className="p-0">
        <DataTable
          rows={rows}
          getRowId={r => r.id}
          columns={columns}
          defaultSortKey="name"
          defaultSortDir="asc"
          downloadable={{ filename: 'vendors', title: 'Vendors' }}
          actionsHeader={<span className="inline-flex items-center gap-1.5">Action <Settings className="h-3.5 w-3.5" /></span>}
          actions={r => (
            <span className="inline-flex items-center gap-2">
              <Link className="text-primary hover:underline" to={`/ap/bills/new?vendor_id=${r.id}`}>Create bill</Link>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </span>
          )}
          emptyMessage={<EmptyState title="No vendors yet" hint="Add a vendor to start tracking bills and expenses." actionLabel="New vendor" actionTo="/ap/vendors/new" />}
        />
      </CardContent></Card>
    </div>
  );
}
