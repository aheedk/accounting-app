import { useEffect, useState } from 'react';
import { DateInput } from '@/components/ui/date-input';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { fmtMoney } from '@/lib/money';
import { DownloadButtons } from '@/components/ui/DownloadButtons';

type Row = { customer_id: string; customer_name: string; current: string; over_30: string; over_60: string; over_90: string; total: string };

export default function AgingReportPage() {
  const [bizId] = useActiveBusinessId();
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => { if (bizId) api.get(`/businesses/${bizId}/reports/aging`, { params: { as_of: asOf } }).then(r => setRows(r.data.rows)); }, [bizId, asOf]);
  if (!bizId) return <div>Pick a business.</div>;
  const totals = rows.reduce((acc, r) => ({
    current: acc.current + parseFloat(r.current),
    over_30: acc.over_30 + parseFloat(r.over_30),
    over_60: acc.over_60 + parseFloat(r.over_60),
    over_90: acc.over_90 + parseFloat(r.over_90),
    total: acc.total + parseFloat(r.total),
  }), { current: 0, over_30: 0, over_60: 0, over_90: 0, total: 0 });
  const dlHeaders = ['Customer', 'Current', '1-30', '31-60', '60+', 'Total'];
  const dlRows = () => rows.map(r => [r.customer_name, r.current, r.over_30, r.over_60, r.over_90, r.total]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">AR Aging</h1>
        <div className="flex flex-wrap items-end gap-2">
          <div><Label>As of</Label><DateInput value={asOf} onChange={e => setAsOf(e.target.value)} /></div>
          <DownloadButtons headers={dlHeaders} getRows={dlRows} filename="ar-aging" title={`AR Aging — ${asOf}`} />
        </div>
      </div>
      <Card><CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40"><tr><th className="text-left p-3">Customer</th><th className="text-right p-3">Current</th><th className="text-right p-3">1-30</th><th className="text-right p-3">31-60</th><th className="text-right p-3">60+</th><th className="text-right p-3">Total</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.customer_id} className="border-b last:border-b-0">
              <td className="p-3">{r.customer_name}</td>
              <td className="p-3 text-right">{fmtMoney(r.current)}</td>
              <td className="p-3 text-right">{fmtMoney(r.over_30)}</td>
              <td className="p-3 text-right">{fmtMoney(r.over_60)}</td>
              <td className="p-3 text-right">{fmtMoney(r.over_90)}</td>
              <td className="p-3 text-right">{fmtMoney(r.total)}</td>
            </tr>
          ))}
          <tr className="font-semibold bg-muted/20">
            <td className="p-3 text-right">Totals</td>
            <td className="p-3 text-right">{fmtMoney(totals.current)}</td>
            <td className="p-3 text-right">{fmtMoney(totals.over_30)}</td>
            <td className="p-3 text-right">{fmtMoney(totals.over_60)}</td>
            <td className="p-3 text-right">{fmtMoney(totals.over_90)}</td>
            <td className="p-3 text-right">{fmtMoney(totals.total)}</td>
          </tr>
          </tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}
