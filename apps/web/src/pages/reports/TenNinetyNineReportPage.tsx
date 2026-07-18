import { useEffect, useState } from 'react';
import { FileDown, Printer } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { useAuth } from '@/auth/useAuth';
import { Input } from '@/components/ui/input';
import { ReportCard } from '@/components/ui/ReportCard';
import { fmtMoney } from '@/lib/money';
import { downloadAsExcel } from '@/lib/download';
import { currentYearLocal } from '@/lib/dates';

type Row = { vendor_id: string; vendor_name: string; tax_id: string | null; total_paid: string };

export default function TenNinetyNineReportPage() {
  const [bizId] = useActiveBusinessId();
  const { businesses } = useAuth();
  const bizName = businesses.find(b => b.id === bizId)?.name ?? '';
  const [year, setYear] = useState<number>(currentYearLocal());
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => { if (bizId) api.get(`/businesses/${bizId}/reports/1099`, { params: { year } }).then(r => setRows(r.data.rows)); }, [bizId, year]);
  if (!bizId) return <div>Pick a business.</div>;
  const total = rows.reduce((acc, r) => acc + parseFloat(r.total_paid), 0);
  const dlHeaders = ['Vendor', 'Tax ID', 'Total Paid'];
  const dlRows = () => rows.map(r => [r.vendor_name, r.tax_id ?? '—', r.total_paid]);

  const [excelBusy, setExcelBusy] = useState(false);

  function handleExport() {
    setExcelBusy(true);
    try { downloadAsExcel(dlHeaders, dlRows(), `1099-${year}`); } finally { setExcelBusy(false); }
  }

  function handlePrint() {
    const rowsHtml = dlRows().map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>1099 Report</title><style>body{font-family:Arial,sans-serif;font-size:11px;margin:24px}h2{margin-bottom:4px}p{color:#666;font-size:10px;margin-bottom:16px}table{width:100%;border-collapse:collapse}th{background:#f0f0f0;text-align:left;padding:5px 7px;border-bottom:2px solid #ccc;font-size:10px;text-transform:uppercase}td{padding:4px 7px;border-bottom:1px solid #e5e5e5}</style></head><body><h2>1099 Report — ${year}</h2><p>Generated ${new Date().toLocaleDateString()}</p><table><thead><tr>${dlHeaders.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rowsHtml}</tbody></table><script>window.onload=function(){window.print()}<\/script></body></html>`);
    win.document.close();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">1099 Report</h1>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Year</div>
            <Input className="w-28 font-mono" type="number" value={year} onChange={e => setYear(parseInt(e.target.value, 10) || currentYearLocal())} />
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

      <ReportCard companyName={bizName} title="1099 Contractor Payments" subtitle={`Calendar year ${year}`}>
        <div className="w-full overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b">
            <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th className="p-3 text-left">Vendor</th>
              <th className="p-3 text-left">Tax ID</th>
              <th className="p-3 text-right">Total paid</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr className="border-b"><td colSpan={3} className="p-6 text-center text-muted-foreground">No 1099 payments recorded for {year}.</td></tr>
            )}
            {rows.map(r => (
              <tr key={r.vendor_id} className="border-b hover:bg-muted/30">
                <td className="p-3">{r.vendor_name}</td>
                <td className="p-3 font-mono">{r.tax_id ?? '—'}</td>
                <td className="p-3 text-right font-mono">{fmtMoney(r.total_paid)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="p-3" colSpan={2}>TOTAL</td>
              <td className="p-3 text-right font-mono">{fmtMoney(total)}</td>
            </tr>
          </tbody>
        </table>
        </div>
      </ReportCard>
    </div>
  );
}
