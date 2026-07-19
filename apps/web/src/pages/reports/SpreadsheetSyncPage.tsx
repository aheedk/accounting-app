import { useState } from 'react';
import { FileDown, Printer } from 'lucide-react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { DateInput } from '@/components/ui/date-input';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { todayLocal } from '@/lib/dates';
import { pickErr } from '@/lib/apiErrors';


function parseCSVLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

async function fetchAndParseCSV(url: string, params: Record<string, string>): Promise<string[][]> {
  const r = await api.get(url, { params, responseType: 'text' });
  const text = r.data as string;
  return text.trim().split('\n').map(parseCSVLine);
}

async function downloadExcel(url: string, params: Record<string, string>, filename: string) {
  const rows = await fetchAndParseCSV(url, params);
  const [header, ...body] = rows;
  const ws = XLSX.utils.aoa_to_sheet([header ?? [], ...body.filter(r => r.some(c => c.trim() !== ''))]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  XLSX.writeFile(wb, filename);
}

async function downloadPdf(url: string, params: Record<string, string>, title: string, filename: string) {
  const rows = await fetchAndParseCSV(url, params);
  const [header, ...body] = rows;
  const cleanBody = body.filter(r => r.some(c => c.trim() !== ''));
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(13);
  doc.text(title, 14, 14);
  autoTable(doc, {
    head: [header ?? []],
    body: cleanBody,
    startY: 20,
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [230, 230, 230], textColor: [0, 0, 0], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [250, 250, 250] },
  });
  doc.save(filename);
}

export default function SpreadsheetSyncPage() {
  const [bizId] = useActiveBusinessId();
  const today = todayLocal();

  const [jeFrom, setJeFrom] = useState('');
  const [jeTo, setJeTo] = useState(today);
  const [jeExcelBusy, setJeExcelBusy] = useState(false);
  const [jePdfBusy, setJePdfBusy] = useState(false);
  const [jeErr, setJeErr] = useState<string | null>(null);

  if (!bizId) return <div>Pick a business.</div>;

  async function handleJe(format: 'excel' | 'pdf') {
    const setBusy = format === 'excel' ? setJeExcelBusy : setJePdfBusy;
    setBusy(true);
    setJeErr(null);
    try {
      const url = `/businesses/${bizId}/csv-exports/journal-entries`;
      const params: Record<string, string> = {};
      if (jeFrom) params.from = jeFrom;
      if (jeTo) params.to = jeTo;
      const label = `${jeFrom || 'all'}-to-${jeTo || 'all'}`;
      if (format === 'excel') {
        await downloadExcel(url, params, `journal-entries-${label}.xlsx`);
      } else {
        await downloadPdf(url, params, `Journal Entry Lines — ${label}`, `journal-entries-${label}.pdf`);
      }
    } catch (e: unknown) {
      setJeErr(pickErr(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Spreadsheet Sync</h1>
      <p className="text-sm text-muted-foreground">
        Download Journal Entry Lines as Excel or PDF. Trial Balance exports are available on the Trial Balance page.
      </p>

      <Card>
        <CardHeader><CardTitle>Journal Entry Lines</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label>From date</Label>
              <DateInput value={jeFrom} onChange={e => setJeFrom(e.target.value)} />
            </div>
            <div>
              <Label>To date</Label>
              <DateInput value={jeTo} onChange={e => setJeTo(e.target.value)} />
            </div>
            <div className="relative group">
              <button className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50" onClick={() => void handleJe('excel')} disabled={jeExcelBusy} aria-label="Export to Excel">
                <FileDown className="h-4 w-4" />
              </button>
              <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">Export to Excel</div>
            </div>
            <div className="relative group">
              <button className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50" onClick={() => void handleJe('pdf')} disabled={jePdfBusy} aria-label="Print">
                <Printer className="h-4 w-4" />
              </button>
              <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">Print</div>
            </div>
          </div>
          {jeErr && <p className="text-sm text-destructive">{jeErr}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
