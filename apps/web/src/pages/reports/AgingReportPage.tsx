import { useEffect, useState } from 'react';
import { FileDown, Printer } from 'lucide-react';
import { DateInput } from '@/components/ui/date-input';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { useAuth } from '@/auth/useAuth';
import { fmtMoney } from '@/lib/money';
import { downloadAsExcel } from '@/lib/download';
import { ReportCard } from '@/components/ui/ReportCard';
import { fmtLongDate, todayLocal } from '@/lib/dates';

type Row = { customer_id: string; customer_name: string; current: string; over_30: string; over_60: string; over_90: string; total: string };

// QBO leaves zero cells blank in aging reports.
function cell(v: string) {
  return Number(v) === 0 ? '' : fmtMoney(v);
}

export default function AgingReportPage() {
  const [bizId] = useActiveBusinessId();
  const { businesses } = useAuth();
  const bizName = businesses.find(b => b.id === bizId)?.name ?? '';
  const [asOf, setAsOf] = useState(todayLocal());
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

  const [excelBusy, setExcelBusy] = useState(false);

  function handleExport() {
    setExcelBusy(true);
    try { downloadAsExcel(dlHeaders, dlRows(), 'ar-aging'); } finally { setExcelBusy(false); }
  }

  function handlePrint() {
    const rowsHtml = dlRows().map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>AR Aging</title><style>body{font-family:Arial,sans-serif;font-size:11px;margin:24px}h2{margin-bottom:4px}p{color:#666;font-size:10px;margin-bottom:16px}table{width:100%;border-collapse:collapse}th{background:#f0f0f0;text-align:left;padding:5px 7px;border-bottom:2px solid #ccc;font-size:10px;text-transform:uppercase}td{padding:4px 7px;border-bottom:1px solid #e5e5e5}</style></head><body><h2>AR Aging — ${asOf}</h2><p>Generated ${new Date().toLocaleDateString()}</p><table><thead><tr>${dlHeaders.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rowsHtml}</tbody></table><script>window.onload=function(){window.print()}<\/script></body></html>`);
    win.document.close();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">AR Aging</h1>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <div className="mb-1 text-xs text-muted-foreground">as of</div>
            <DateInput value={asOf} onChange={e => setAsOf(e.target.value)} />
          </div>
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
          </div>
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
