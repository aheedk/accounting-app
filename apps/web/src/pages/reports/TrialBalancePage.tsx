import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { DateInput } from '@/components/ui/date-input';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { fmtMoney, fmtSigned } from '@/lib/money';
import { todayLocal } from '@/lib/dates';

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
          <div><Label>As of</Label><DateInput value={asOf} onChange={e => setAsOf(e.target.value)} /></div>
          <Button variant="outline" disabled={excelBusy} onClick={() => void handleDownload('excel')}>
            {excelBusy ? 'Downloading…' : 'Download Excel'}
          </Button>
          <Button variant="outline" disabled={pdfBusy} onClick={() => void handleDownload('pdf')}>
            {pdfBusy ? 'Downloading…' : 'Download PDF'}
          </Button>
        </div>
      </div>
      {dlErr && <p className="text-sm text-destructive">{dlErr}</p>}
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
