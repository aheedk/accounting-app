import { useCallback, useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { useActiveBusinessId } from '@/lib/business';
import { api } from '@/lib/apiClient';
import { fmtMoney } from '@/lib/money';
import { pickErr } from '@/lib/apiErrors';
import { todayLocal } from '@/lib/dates';
import { flashMessage } from '@/lib/flash';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';

type Overview = {
  total_items_count: number;
  total_stock_value: string;
  /** Stock recorded before inventory posted to the ledger, not yet posted. */
  unposted_stock_value: string;
  recent_receipts: Array<{ id: string; receipt_date: string; po_number: string }>;
  recent_sales: Array<{ id: string; order_date: string; so_number: string }>;
};

function fmtShortDate(iso: string) {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

export default function InventoryOverviewPage() {
  const [bizId] = useActiveBusinessId();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openingDate, setOpeningDate] = useState(todayLocal());
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!bizId) return;
    setError(null);
    api
      .get<Overview>(`/businesses/${bizId}/inventory-overview`)
      .then((r) => setData(r.data))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'load failed'));
  }, [bizId]);

  useEffect(() => { setData(null); load(); }, [load]);

  // Stock entered before inventory posted to the ledger: one entry brings the books level with it.
  async function postOpeningBalance() {
    if (!bizId || posting) return;
    setPosting(true); setPostError(null);
    try {
      await api.post(`/businesses/${bizId}/inventory/post-opening-balance`, { entry_date: openingDate });
      flashMessage('Opening inventory posted');
      load();
    } catch (e: unknown) {
      setPostError(pickErr(e));
    } finally {
      setPosting(false);
    }
  }

  if (error) return <div className="text-destructive">{error}</div>;
  if (!data) return <div className="text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Inventory Overview</h1>
      {Number(data.unposted_stock_value) !== 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p>
            Stock worth <span className="font-mono font-medium">{fmtMoney(data.unposted_stock_value)}</span> was entered
            before inventory posted to the ledger, so the Inventory account does not include it yet. Posting it makes
            one journal entry: debit Inventory, credit Opening Balance Equity.
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <div>
              <div className="mb-1 text-xs">Dated</div>
              <DateInput value={openingDate} onChange={e => setOpeningDate(e.target.value)} />
            </div>
            <Button type="button" onClick={() => { void postOpeningBalance(); }} disabled={posting}>
              {posting ? 'Posting…' : 'Post opening balance'}
            </Button>
          </div>
          {postError && <p className="mt-2 text-destructive">{postError}</p>}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Items</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">{data.total_items_count}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Stock Value</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold font-mono">{fmtMoney(data.total_stock_value)}</CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Recent receipts</CardTitle>
        </CardHeader>
        <CardContent>
          {data.recent_receipts.length === 0 ? (
            <div className="text-sm text-muted-foreground">No receipts yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">PO</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_receipts.map((r) => (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-3 py-2 whitespace-nowrap">{fmtShortDate(r.receipt_date)}</td>
                    <td className="px-3 py-2 font-mono">{r.po_number}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Recent sales</CardTitle>
        </CardHeader>
        <CardContent>
          {data.recent_sales.length === 0 ? (
            <div className="text-sm text-muted-foreground">No fulfilled sales orders yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">SO</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_sales.map((r) => (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-3 py-2 whitespace-nowrap">{fmtShortDate(r.order_date)}</td>
                    <td className="px-3 py-2 font-mono">{r.so_number}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
