import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileDown, Printer } from 'lucide-react';
import { downloadAsExcel } from '@/lib/download';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';

type ItemReceipt = {
  id: string;
  business_id: string;
  purchase_order_id: string;
  receipt_date: string;
  bill_id: string | null;
  memo: string | null;
};

type PurchaseOrderSummary = {
  id: string;
  po_number: string;
};

type BillSummary = {
  id: string;
  bill_number: string;
};

type ListResponse = { item_receipts: ItemReceipt[] };
type POListResponse = { purchase_orders: PurchaseOrderSummary[] };
type BillsListResponse = { bills: BillSummary[] };

function fmtShortDate(iso: string) {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

function pickErr(e: unknown): string {
  return (
    (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data
      ?.error?.message ?? 'Failed'
  );
}

export default function ItemReceiptListPage() {
  const [bizId] = useActiveBusinessId();
  const [receipts, setReceipts] = useState<ItemReceipt[]>([]);
  const [excelBusy, setExcelBusy] = useState(false);
  const [poMap, setPoMap] = useState<Map<string, string>>(new Map());
  const [billMap, setBillMap] = useState<Map<string, string>>(new Map());
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!bizId) return;
    setLoading(true);
    setErr(null);
    Promise.all([
      api.get<ListResponse>(`/businesses/${bizId}/item-receipts`),
      api.get<POListResponse>(`/businesses/${bizId}/purchase-orders`),
      api.get<BillsListResponse>(`/businesses/${bizId}/bills`),
    ])
      .then(([rRec, rPo, rBill]) => {
        setReceipts(rRec.data.item_receipts);
        setPoMap(new Map(rPo.data.purchase_orders.map((p) => [p.id, p.po_number])));
        setBillMap(new Map(rBill.data.bills.map((b) => [b.id, b.bill_number])));
      })
      .catch((e: unknown) => setErr(pickErr(e)))
      .finally(() => setLoading(false));
  }, [bizId]);

  type Row = ItemReceipt & { po_number: string; bill_number: string | null };
  const rows: Row[] = useMemo(
    () => receipts.map(r => ({
      ...r,
      po_number: poMap.get(r.purchase_order_id) ?? '',
      bill_number: r.bill_id ? (billMap.get(r.bill_id) ?? null) : null,
    })),
    [receipts, poMap, billMap],
  );

  const columns: Column<Row>[] = [
    { key: 'receipt_date', header: 'Receipt Date', sortable: true, sortValue: r => Date.parse(r.receipt_date), render: r => <span className="whitespace-nowrap">{fmtShortDate(r.receipt_date)}</span> },
    { key: 'po_number', header: 'PO #', sortable: true, sortValue: r => r.po_number, render: r => <span className="font-mono">{r.po_number || <span className="text-muted-foreground">—</span>}</span> },
    { key: 'bill_number', header: 'Bill #', sortable: true, sortValue: r => r.bill_number ?? '', render: r => r.bill_id ? (
      <Link className="font-mono text-primary hover:underline" to={`/ap/bills/${r.bill_id}`}>
        {r.bill_number ?? r.bill_id.slice(0, 8)}
      </Link>
    ) : <span className="text-muted-foreground">—</span> },
    { key: 'memo', header: 'Memo', render: r => r.memo || <span className="text-muted-foreground">—</span> },
  ];

  if (!bizId) return <div>Pick a business.</div>;

  const dlHeaders = columns.map(c => c.header);
  const dlRows = () => rows.map(row => columns.map(col => col.sortValue ? String(col.sortValue(row)) : ''));

  function handleExport() {
    setExcelBusy(true);
    try { downloadAsExcel(dlHeaders, dlRows(), 'item-receipts'); } finally { setExcelBusy(false); }
  }

  function handlePrint() {
    const rowsHtml = dlRows().map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>Item Receipts</title><style>body{font-family:Arial,sans-serif;font-size:11px;margin:24px}h2{margin-bottom:4px}p{color:#666;font-size:10px;margin-bottom:16px}table{width:100%;border-collapse:collapse}th{background:#f0f0f0;text-align:left;padding:5px 7px;border-bottom:2px solid #ccc;font-size:10px;text-transform:uppercase}td{padding:4px 7px;border-bottom:1px solid #e5e5e5}</style></head><body><h2>Item Receipts</h2><p>Generated ${new Date().toLocaleDateString()}</p><table><thead><tr>${dlHeaders.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rowsHtml}</tbody></table><script>window.onload=function(){window.print()}<\/script></body></html>`);
    win.document.close();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Item Receipts</h1>
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
            <Link to="/inventory/item-receipts/new">Receive items</Link>
          </Button>
        </div>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : (
            <DataTable
              rows={rows}
              getRowId={r => r.id}
              columns={columns}
              defaultSortKey="receipt_date"
              defaultSortDir="desc"
              downloadable={{ filename: 'item-receipts', title: 'Item Receipts' }}
              emptyMessage={<EmptyState title="No item receipts yet" hint="Receive against a sent purchase order to record stock arriving." actionLabel="Receive items" actionTo="/inventory/item-receipts/new" />}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
