import { useEffect, useState } from 'react';
import { DateInput } from '@/components/ui/date-input';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { useAuth } from '@/auth/useAuth';
import { fmtMoney } from '@/lib/money';
import { DownloadButtons } from '@/components/ui/DownloadButtons';
import { ReportCard } from '@/components/ui/ReportCard';

type Row = { customer_id: string; customer_name: string; current: string; over_30: string; over_60: string; over_90: string; total: string };

function fmtLongDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

// QBO leaves zero cells blank in aging reports.
function cell(v: string) {
  return Number(v) === 0 ? '' : fmtMoney(v);
}

export default function AgingReportPage() {
  const [bizId] = useActiveBusinessId();
  const { businesses } = useAuth();
  const bizName = businesses.find(b => b.id === bizId)?.name ?? '';
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
  const dlHeaders = ['Customer', 'Current', '1-30', '31-60', '61 and over', 'Total'];
  const dlRows = () => rows.map(r => [r.customer_name, r.current, r.over_30, r.over_60, r.over_90, r.total]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">AR Aging</h1>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <div className="mb-1 text-xs text-muted-foreground">as of</div>
            <DateInput value={asOf} onChange={e => setAsOf(e.target.value)} />
          </div>
          <DownloadButtons headers={dlHeaders} getRows={dlRows} filename="ar-aging" title={`AR Aging — ${asOf}`} />
        </div>
      </div>

      <ReportCard companyName={bizName} title="A/R Aging Summary Report" subtitle={`As of ${fmtLongDate(asOf)}`}>
        <table className="w-full text-sm">
          <thead className="border-b">
            <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th className="p-3 text-left"></th>
              <th className="p-3 text-right">Current</th>
              <th className="p-3 text-right">1 - 30</th>
              <th className="p-3 text-right">31 - 60</th>
              <th className="p-3 text-right">61 and over</th>
              <th className="p-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.customer_id} className="border-b hover:bg-muted/30">
                <td className="p-3">{r.customer_name}</td>
                <td className="p-3 text-right font-mono">{cell(r.current)}</td>
                <td className="p-3 text-right font-mono">{cell(r.over_30)}</td>
                <td className="p-3 text-right font-mono">{cell(r.over_60)}</td>
                <td className="p-3 text-right font-mono">{cell(r.over_90)}</td>
                <td className="p-3 text-right font-mono">{fmtMoney(r.total)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No open balances as of this date.</td></tr>
            )}
            <tr className="font-semibold">
              <td className="p-3">TOTAL</td>
              <td className="p-3 text-right font-mono">{fmtMoney(totals.current)}</td>
              <td className="p-3 text-right font-mono">{fmtMoney(totals.over_30)}</td>
              <td className="p-3 text-right font-mono">{fmtMoney(totals.over_60)}</td>
              <td className="p-3 text-right font-mono">{fmtMoney(totals.over_90)}</td>
              <td className="p-3 text-right font-mono">{fmtMoney(totals.total)}</td>
            </tr>
          </tbody>
        </table>
      </ReportCard>
    </div>
  );
}
