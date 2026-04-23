import { useEffect, useState } from 'react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fmtMoney } from '@/lib/money';

type Row = { vendor_id: string; vendor_name: string; tax_id: string | null; total_paid: string };

export default function TenNinetyNineReportPage() {
  const [bizId] = useActiveBusinessId();
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => { if (bizId) api.get(`/businesses/${bizId}/reports/1099`, { params: { year } }).then(r => setRows(r.data.rows)); }, [bizId, year]);
  if (!bizId) return <div>Pick a business.</div>;
  const total = rows.reduce((acc, r) => acc + parseFloat(r.total_paid), 0);
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">1099 Report</h1>
        <div>
          <Label>Year</Label>
          <Input type="number" value={year} onChange={e => setYear(parseInt(e.target.value, 10) || new Date().getFullYear())} />
        </div>
      </div>
      <Card><CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40"><tr><th className="text-left p-3">Vendor</th><th className="text-left p-3">Tax ID</th><th className="text-right p-3">Total Paid</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.vendor_id} className="border-b last:border-b-0">
              <td className="p-3">{r.vendor_name}</td>
              <td className="p-3">{r.tax_id ?? '—'}</td>
              <td className="p-3 text-right">{fmtMoney(r.total_paid)}</td>
            </tr>
          ))}
          <tr className="font-semibold bg-muted/20">
            <td className="p-3 text-right" colSpan={2}>Total</td>
            <td className="p-3 text-right">{total.toFixed(2)}</td>
          </tr>
          </tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}
