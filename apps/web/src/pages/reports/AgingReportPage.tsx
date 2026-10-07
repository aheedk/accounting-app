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
import { printReport } from '@/lib/reportExport';

type Row = {
  id: string; name: string;
  current: string; days_1_30: string; days_31_60: string; days_61_90: string; days_over_90: string; total: string;
};
const BUCKETS = ['current', 'days_1_30', 'days_31_60', 'days_61_90', 'days_over_90'] as const;
const BUCKET_LABELS = ['Current', '1 - 30', '31 - 60', '61 - 90', '91 and over'];

// One page for both sides: who owes the client (A/R) and who the client owes (A/P).
const KINDS = {
  ar: { endpoint: 'aging', heading: 'AR Aging', title: 'A/R Aging Summary', party: 'Customer', file: 'ar-aging' },
  ap: { endpoint: 'ap-aging', heading: 'AP Aging', title: 'A/P Aging Summary', party: 'Vendor', file: 'ap-aging' },
} as const;

// QBO leaves zero cells blank in aging reports.
function cell(v: string) {
  return Number(v) === 0 ? '' : fmtMoney(v);
}

export default function AgingReportPage({ kind = 'ar' }: { kind?: keyof typeof KINDS }) {
  const report = KINDS[kind];
  const [bizId] = useActiveBusinessId();
  const { businesses } = useAuth();
  const bizName = businesses.find(b => b.id === bizId)?.name ?? '';
  const [asOf, setAsOf] = useState(todayLocal());
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    if (bizId) api.get(`/businesses/${bizId}/reports/${report.endpoint}`, { params: { as_of: asOf } }).then(r => setRows(r.data.rows));
  }, [bizId, asOf, report.endpoint]);
  const [excelBusy, setExcelBusy] = useState(false);
  if (!bizId) return <div>Pick a business.</div>;
  const bucketTotals = BUCKETS.map(bucket => rows.reduce((sum, r) => sum + parseFloat(r[bucket]), 0));
  const grandTotal = rows.reduce((sum, r) => sum + parseFloat(r.total), 0);
  const dlHeaders = [report.party, ...BUCKET_LABELS.map(label => label.replace(/ - /, '-')), 'Total'];
  const dlRows = () => rows.map(r => [r.name, ...BUCKETS.map(bucket => r[bucket]), r.total]);
  function handleExport() {
    setExcelBusy(true);
    try { downloadAsExcel(dlHeaders, dlRows(), report.file, { title: report.title, subtitle: `As of ${fmtLongDate(asOf)}` }); } finally { setExcelBusy(false); }
  }

  function handlePrint() {
    printReport({ title: report.title, subtitle: `As of ${fmtLongDate(asOf)}`, headers: dlHeaders, rows: dlRows() });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">{report.heading}</h1>
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

      <ReportCard companyName={bizName} title={`${report.title} Report`} subtitle={`As of ${fmtLongDate(asOf)}`}>
        <div className="w-full overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm sm:min-w-0">
          <thead className="border-b">
            <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th className="p-3 text-left"></th>
              {BUCKET_LABELS.map(label => <th key={label} className="p-3 text-right">{label}</th>)}
              <th className="p-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-b hover:bg-muted/30">
                <td className="p-3">{r.name}</td>
                {BUCKETS.map(bucket => <td key={bucket} className="p-3 text-right font-mono">{cell(r[bucket])}</td>)}
                <td className="p-3 text-right font-mono">{fmtMoney(r.total)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No open balances as of this date.</td></tr>
            )}
            <tr className="font-semibold">
              <td className="p-3">TOTAL</td>
              {bucketTotals.map((total, i) => <td key={BUCKETS[i]} className="p-3 text-right font-mono">{fmtMoney(total)}</td>)}
              <td className="p-3 text-right font-mono">{fmtMoney(grandTotal)}</td>
            </tr>
          </tbody>
        </table>
        </div>
      </ReportCard>
    </div>
  );
}
