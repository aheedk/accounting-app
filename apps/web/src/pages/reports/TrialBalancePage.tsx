import { useEffect, useState } from 'react';
import { FileDown, Printer } from 'lucide-react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { DateInput } from '@/components/ui/date-input';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { useAuth } from '@/auth/useAuth';
import { ReportCard } from '@/components/ui/ReportCard';
import { fmtMoney, fmtSigned } from '@/lib/money';
import { fmtLongDate, todayLocal } from '@/lib/dates';

function parseCSVLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === ',' && !inQuotes) { cells.push(current); current = ''; }
    else { current += ch; }
  }
  cells.push(current);
  return cells;
}

async function fetchCSV(url: string, params: Record<string, string>): Promise<string[][]> {
  const r = await api.get(url, { params, responseType: 'text' });
  return (r.data as string).trim().split('\n').map(parseCSVLine);
}

async function doDownloadExcel(url: string, params: Record<string, string>, filename: string) {
  const rows = await fetchCSV(url, params);
  const [header, ...body] = rows;
  const ws = XLSX.utils.aoa_to_sheet([header ?? [], ...body.filter(r => r.some(c => c.trim()))]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  XLSX.writeFile(wb, filename);
}

async function doDownloadPdf(url: string, params: Record<string, string>, title: string, filename: string) {
  const rows = await fetchCSV(url, params);
  const [header, ...body] = rows;
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(13);
  doc.text(title, 14, 14);
  autoTable(doc, {
    head: [header ?? []], body: body.filter(r => r.some(c => c.trim())),
    startY: 20, styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [230, 230, 230], textColor: [0, 0, 0], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [250, 250, 250] },
  });
  doc.save(filename);
}

type Row = { account_id: string; code: string; name: string; account_type: string; total_debit: string; total_credit: string; net: string };

export default function TrialBalancePage() {
  const [bizId] = useActiveBusinessId();
  const { businesses } = useAuth();
  const bizName = businesses.find(b => b.id === bizId)?.name ?? '';
  const [asOf, setAsOf] = useState(todayLocal());
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState({ total_debit: '0', total_credit: '0' });
  const [excelBusy, setExcelBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [dlErr, setDlErr] = useState<string | null>(null);

  async function handleDownload(format: 'excel' | 'pdf') {
    if (!bizId) return;
    const setBusy = format === 'excel' ? setExcelBusy : setPdfBusy;
    setBusy(true);
    setDlErr(null);
    try {
      const url = `/businesses/${bizId}/csv-exports/trial-balance`;
      const params = { as_of: asOf };
      if (format === 'excel') {
        await doDownloadExcel(url, params, `trial-balance-${asOf}.xlsx`);
      } else {
        await doDownloadPdf(url, params, `Trial Balance — ${asOf}`, `trial-balance-${asOf}.pdf`);
      }
    } catch {
      setDlErr('Download failed');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/reports/trial-balance`, { params: { as_of: asOf } })
      .then(r => { setRows(r.data.rows); setTotals(r.data.totals); });
  }, [bizId, asOf]);

  if (!bizId) return <div>Pick a business.</div>;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">Trial Balance</h1>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <div className="mb-1 text-xs text-muted-foreground">as of</div>
            <DateInput value={asOf} onChange={e => setAsOf(e.target.value)} />
          </div>
          <div className="relative group">
            <button className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50" onClick={() => void handleDownload('excel')} disabled={excelBusy} aria-label="Export to Excel">
              <FileDown className="h-4 w-4" />
            </button>
            <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">Export to Excel</div>
          </div>
          <div className="relative group">
            <button className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50" onClick={() => void handleDownload('pdf')} disabled={pdfBusy} aria-label="Print">
              <Printer className="h-4 w-4" />
            </button>
            <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">Print</div>
          </div>
        </div>
      </div>
      {dlErr && <p className="text-sm text-destructive">{dlErr}</p>}
      <ReportCard companyName={bizName} title="Trial Balance" subtitle={`As of ${fmtLongDate(asOf)}`}>
        <div className="w-full overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm sm:min-w-0">
          <thead className="border-b">
            <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th className="p-3 text-left">Code</th>
              <th className="p-3 text-left">Account</th>
              <th className="p-3 text-left">Type</th>
              <th className="p-3 text-right">Debit</th>
              <th className="p-3 text-right">Credit</th>
              <th className="p-3 text-right">Net</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.account_id} className="border-b hover:bg-muted/30">
                <td className="p-3 font-mono">{r.code}</td>
                <td className="p-3">{r.name}</td>
                <td className="p-3 capitalize">{r.account_type}</td>
                <td className="p-3 text-right font-mono">{fmtMoney(r.total_debit)}</td>
                <td className="p-3 text-right font-mono">{fmtMoney(r.total_credit)}</td>
                <td className="p-3 text-right font-mono">{fmtSigned(r.net)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td colSpan={3} className="p-3">TOTAL</td>
              <td className="p-3 text-right font-mono">{fmtMoney(totals.total_debit)}</td>
              <td className="p-3 text-right font-mono">{fmtMoney(totals.total_credit)}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
        </div>
      </ReportCard>
    </div>
  );
}
