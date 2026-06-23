import { useEffect, useState } from 'react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { useAuth } from '@/auth/useAuth';
import { Input } from '@/components/ui/input';
import { ReportCard } from '@/components/ui/ReportCard';
import { fmtMoney } from '@/lib/money';
import { DownloadButtons } from '@/components/ui/DownloadButtons';
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
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">1099 Report</h1>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Year</div>
            <Input className="w-28 font-mono" type="number" value={year} onChange={e => setYear(parseInt(e.target.value, 10) || currentYearLocal())} />
          </div>
          <DownloadButtons headers={dlHeaders} getRows={dlRows} filename={`1099-${year}`} title={`1099 Report — ${year}`} />
        </div>
      </div>

      <ReportCard companyName={bizName} title="1099 Contractor Payments" subtitle={`Calendar year ${year}`}>
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
      </ReportCard>
    </div>
  );
}
