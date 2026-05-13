import { useEffect, useState } from 'react';
import { DateInput } from '@/components/ui/date-input';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fmtMoney, fmtSigned } from '@/lib/money';

type Row = { account_id: string; code: string; name: string; account_type: string; total_debit: string; total_credit: string; net: string };

export default function TrialBalancePage() {
  const [bizId] = useActiveBusinessId();
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState({ total_debit: '0', total_credit: '0' });

  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/reports/trial-balance`, { params: { as_of: asOf } })
      .then(r => { setRows(r.data.rows); setTotals(r.data.totals); });
  }, [bizId, asOf]);

  if (!bizId) return <div>Pick a business.</div>;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Trial Balance</h1>
        <div className="flex items-end gap-2">
          <div><Label>As of</Label><DateInput value={asOf} onChange={e => setAsOf(e.target.value)} /></div>
        </div>
      </div>
      <Card><CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr><th className="text-left p-3">Code</th><th className="text-left p-3">Account</th><th className="text-left p-3">Type</th><th className="text-right p-3">Debit</th><th className="text-right p-3">Credit</th><th className="text-right p-3">Net</th></tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.account_id} className="border-b last:border-b-0">
                <td className="p-3 font-mono">{r.code}</td>
                <td className="p-3">{r.name}</td>
                <td className="p-3">{r.account_type}</td>
                <td className="p-3 text-right">{fmtMoney(r.total_debit)}</td>
                <td className="p-3 text-right">{fmtMoney(r.total_credit)}</td>
                <td className="p-3 text-right">{fmtSigned(r.net)}</td>
              </tr>
            ))}
            <tr className="font-semibold bg-muted/20">
              <td colSpan={3} className="p-3 text-right">Totals</td>
              <td className="p-3 text-right">{fmtMoney(totals.total_debit)}</td>
              <td className="p-3 text-right">{fmtMoney(totals.total_credit)}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}
