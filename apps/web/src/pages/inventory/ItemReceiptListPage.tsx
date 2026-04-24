import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

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

function pickErr(e: unknown): string {
  return (
    (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data
      ?.error?.message ?? 'Failed'
  );
}

export default function ItemReceiptListPage() {
  const [bizId] = useActiveBusinessId();
  const [receipts, setReceipts] = useState<ItemReceipt[]>([]);
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

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Item Receipts</h1>
        <Button asChild>
          <Link to="/inventory/item-receipts/new">Receive items</Link>
        </Button>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : receipts.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No item receipts yet. Receive against a sent purchase order to record one.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="text-left p-3">Receipt Date</th>
                  <th className="text-left p-3">PO #</th>
                  <th className="text-left p-3">Bill #</th>
                  <th className="text-left p-3">Memo</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((r) => {
                  const billNumber = r.bill_id ? billMap.get(r.bill_id) : null;
                  return (
                    <tr key={r.id} className="border-b last:border-b-0">
                      <td className="p-3">{r.receipt_date}</td>
                      <td className="p-3 font-mono">{poMap.get(r.purchase_order_id) ?? '—'}</td>
                      <td className="p-3 font-mono">
                        {r.bill_id ? (
                          <Link className="text-primary underline" to={`/ap/bills/${r.bill_id}`}>
                            {billNumber ?? r.bill_id.slice(0, 8)}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="p-3">{r.memo ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
