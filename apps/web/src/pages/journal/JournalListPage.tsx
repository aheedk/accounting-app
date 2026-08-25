import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, FileDown, Printer, Upload } from 'lucide-react';
import * as XLSX from 'xlsx';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { downloadAsExcel } from '@/lib/download';
import { fmtMoney, parseMoneyInput } from '@/lib/money';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DateInput } from '@/components/ui/date-input';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/input';
import {
  filterJournalEntries,
  formatJournalDate,
  formatJournalSource,
  journalExportRows,
  journalPeriodParams,
  JOURNAL_HEADERS,
  type JournalPeriodPreset,
} from './journalReport';
import type { JournalEntryListItem } from './journalEntryTypes';

type ImportRow = {
  entry_date: string;
  account_code: string;
  debit: string;
  credit: string;
  description: string;
  _status?: string;
  _err?: string;
};

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'posted', label: 'Posted' },
  { value: 'voided', label: 'Void' },
];

const PERIOD_OPTIONS: { value: JournalPeriodPreset; label: string }[] = [
  { value: 'all', label: 'All dates' },
  { value: 'month', label: 'This month' },
  { value: 'year', label: 'This year' },
  { value: 'custom', label: 'Custom' },
];

function pickErr(error: unknown): string {
  return (error as { response?: { data?: { error?: { message?: string } } } } | undefined)
    ?.response?.data?.error?.message ?? 'Failed';
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function statusBadge(status: string) {
  const base = 'inline-flex rounded-full px-2 py-0.5 text-xs font-medium';
  switch (status) {
    case 'draft':
      return <span className={`${base} bg-amber-100 text-amber-800`}>Draft</span>;
    case 'posted':
      return <span className={`${base} bg-emerald-100 text-emerald-800`}>Posted</span>;
    case 'voided':
      return <span className={`${base} bg-muted text-muted-foreground`}>Void</span>;
    default:
      return <span className={`${base} capitalize`}>{status}</span>;
  }
}

function EntryLink({ entryId, children, className = '' }: {
  entryId: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      to={`/journal/${entryId}`}
      className={`text-primary underline-offset-2 hover:underline ${className}`}
      title="Open journal entry"
    >
      {children}
    </Link>
  );
}

export default function JournalListPage() {
  const [bizId] = useActiveBusinessId();
  const [entries, setEntries] = useState<JournalEntryListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [excelBusy, setExcelBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [periodPreset, setPeriodPreset] = useState<JournalPeriodPreset>('all');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const loadEntries = useCallback(async () => {
    if (!bizId) return;
    setLoading(true);
    setLoadError('');
    try {
      const params = {
        limit: 200,
        ...journalPeriodParams(periodPreset, new Date(), customStart, customEnd),
      };
      const response = await api.get(`/businesses/${bizId}/journal-entries`, { params });
      setEntries(response.data.entries);
    } catch (error) {
      setLoadError(pickErr(error));
    } finally {
      setLoading(false);
    }
  }, [bizId, customEnd, customStart, periodPreset]);

  useEffect(() => { void loadEntries(); }, [loadEntries]);

  useEffect(() => {
    function handle(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) setDropdownOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  const filteredEntries = useMemo(
    () => filterJournalEntries(entries, statusFilter, search),
    [entries, statusFilter, search],
  );
  const report = useMemo(() => journalExportRows(filteredEntries), [filteredEntries]);

  function parseFile(file: File) {
    const reader = new FileReader();
    reader.onload = event => {
      const data = new Uint8Array(event.target!.result as ArrayBuffer);
      const workbook = XLSX.read(data, { type: 'array' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]!];
      if (!worksheet) return;
      const raw = XLSX.utils.sheet_to_json<Record<string, string>>(worksheet, { defval: '' });
      setImportRows(raw.map(row => ({
        entry_date: String(row['entry_date'] ?? row['date'] ?? row['Date'] ?? ''),
        account_code: String(row['account_code'] ?? row['account'] ?? row['Account'] ?? ''),
        debit: String(row['debit'] ?? row['Debit'] ?? '0'),
        credit: String(row['credit'] ?? row['Credit'] ?? '0'),
        description: String(row['description'] ?? row['Description'] ?? row['memo'] ?? ''),
      })));
      setImportDone(false);
    };
    reader.readAsArrayBuffer(file);
  }

  async function runImport() {
    if (!bizId || importRows.length === 0) return;
    setImporting(true);
    const updated = [...importRows];
    for (let index = 0; index < updated.length; index++) {
      const row = updated[index]!;
      try {
        await api.post(`/businesses/${bizId}/journal-entries`, {
          entry_date: row.entry_date,
          memo: row.description || null,
          lines: [{
            account_id: row.account_code,
            debit: parseMoneyInput(row.debit || '0'),
            credit: parseMoneyInput(row.credit || '0'),
            memo: row.description || null,
          }],
        });
        updated[index] = { ...row, _status: 'imported' };
      } catch (error: unknown) {
        updated[index] = { ...row, _status: 'error', _err: pickErr(error) };
      }
      setImportRows([...updated]);
    }
    setImporting(false);
    setImportDone(true);
    await loadEntries();
  }

  function handleExport() {
    setExcelBusy(true);
    try {
      downloadAsExcel(JOURNAL_HEADERS, report.rows, 'journal-entries');
    } finally {
      setExcelBusy(false);
    }
  }

  function handlePrint() {
    const rowsHtml = report.rows
      .map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
      .join('');
    const windowRef = window.open('', '_blank');
    if (!windowRef) return;
    windowRef.document.write(`<!DOCTYPE html><html><head><title>Journal Entries</title><style>body{font-family:Arial,sans-serif;font-size:11px;margin:24px}h2{margin-bottom:4px}p{color:#666;font-size:10px;margin-bottom:16px}table{width:100%;border-collapse:collapse}th{background:#f0f0f0;text-align:left;padding:5px 7px;border-bottom:2px solid #ccc;font-size:9px;text-transform:uppercase}td{padding:4px 7px;border-bottom:1px solid #e5e5e5}th:nth-last-child(-n+2),td:nth-last-child(-n+2){text-align:right}</style></head><body><h2>Journal Entries</h2><p>Generated ${escapeHtml(new Date().toLocaleDateString('en-US'))}</p><table><thead><tr>${JOURNAL_HEADERS.map(header => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rowsHtml}</tbody></table><script>window.onload=function(){window.print()}</script></body></html>`);
    windowRef.document.close();
  }

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Journal Entries</h1>
          <p className="mt-1 text-sm text-muted-foreground">Review every account line and open any value to see or correct its journal entry.</p>
        </div>

        <div className="flex items-center gap-2">
          <button className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50" onClick={handleExport} disabled={excelBusy} aria-label="Export to Excel" title="Export to Excel">
            <FileDown className="h-4 w-4" />
          </button>
          <button className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground" onClick={handlePrint} aria-label="Print" title="Print">
            <Printer className="h-4 w-4" />
          </button>

          <div className="relative flex" ref={dropdownRef}>
            <Button asChild className="rounded-r-none">
              <Link to="/journal/new">New entry</Link>
            </Button>
            <button
              onClick={() => setDropdownOpen(open => !open)}
              className="flex items-center justify-center rounded-l-none rounded-r-md border border-l-0 border-primary bg-primary px-2 text-primary-foreground transition-colors hover:bg-primary/90"
              aria-label="More options"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
            {dropdownOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 w-52 rounded-md border bg-popover py-1 shadow-lg">
                <button
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm hover:bg-muted"
                  onClick={() => { setDropdownOpen(false); setImportRows([]); setImportDone(false); setImportOpen(true); }}
                >
                  <Upload className="h-4 w-4" />
                  Import from Excel
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="mb-1 block text-xs text-muted-foreground">Dates</span>
              <select className="h-9 rounded-md border bg-background px-3 text-sm" value={periodPreset} onChange={event => setPeriodPreset(event.target.value as JournalPeriodPreset)}>
                {PERIOD_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            {periodPreset === 'custom' && (
              <>
                <label className="block">
                  <span className="mb-1 block text-xs text-muted-foreground">From</span>
                  <DateInput className="h-9 w-40" value={customStart} onChange={event => setCustomStart(event.target.value)} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-muted-foreground">To</span>
                  <DateInput className="h-9 w-40" value={customEnd} onChange={event => setCustomEnd(event.target.value)} />
                </label>
              </>
            )}
            <label className="block">
              <span className="mb-1 block text-xs text-muted-foreground">Status</span>
              <select className="h-9 rounded-md border bg-background px-3 text-sm" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
                {STATUS_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="min-w-[16rem] flex-1">
              <span className="mb-1 block text-xs text-muted-foreground">Search</span>
              <Input className="h-9" placeholder="Search number, name, description, account, or amount" value={search} onChange={event => setSearch(event.target.value)} />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            Showing {filteredEntries.length} {filteredEntries.length === 1 ? 'entry' : 'entries'} and {filteredEntries.reduce((count, entry) => count + entry.lines.length, 0)} account lines
          </p>
        </CardContent>
      </Card>

      {loadError && <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">{loadError}</div>}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading journal entries…</div>
          ) : filteredEntries.length === 0 ? (
            <EmptyState title="No journal entries found" hint="Adjust the filters above, import entries, or record a manual journal entry." actionLabel="New entry" actionTo="/journal/new" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1050px] border-collapse text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {JOURNAL_HEADERS.map((header, index) => (
                      <th key={header} className={`px-3 py-2 ${index >= 7 ? 'text-right' : ''}`}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.map(entry => {
                    const entryReport = journalExportRows([entry]);
                    const entryHref = `/journal/${entry.id}`;
                    const voided = entry.status === 'voided';
                    return (
                      <Fragment key={entry.id}>
                        <tr className={`border-y bg-muted/20 ${voided ? 'opacity-60' : ''}`}>
                          <td colSpan={9} className="px-3 py-2">
                            <div className="flex items-center gap-3">
                              <Link to={entryHref} className="font-semibold text-primary underline-offset-2 hover:underline">
                                {entry.reference || `${formatJournalSource(entry.source_type)} entry`}
                              </Link>
                              <Link to={entryHref}>{statusBadge(entry.status)}</Link>
                              {entry.memo && <EntryLink entryId={entry.id} className="text-muted-foreground">{entry.memo}</EntryLink>}
                            </div>
                          </td>
                        </tr>
                        {entry.lines.map(line => {
                          const description = line.memo ?? entry.memo;
                          return (
                            <tr key={line.id} className={`border-b hover:bg-muted/20 ${voided ? 'opacity-60' : ''}`}>
                              <td className="whitespace-nowrap px-3 py-2"><EntryLink entryId={entry.id}>{formatJournalDate(entry.entry_date)}</EntryLink></td>
                              <td className="whitespace-nowrap px-3 py-2"><EntryLink entryId={entry.id}>{formatJournalSource(entry.source_type)}</EntryLink></td>
                              <td className="px-3 py-2">{entry.reference ? <EntryLink entryId={entry.id}>{entry.reference}</EntryLink> : <span className="text-muted-foreground">—</span>}</td>
                              <td className="px-3 py-2">{line.name ? <EntryLink entryId={entry.id}>{line.name}</EntryLink> : <span className="text-muted-foreground">—</span>}</td>
                              <td className="max-w-[16rem] px-3 py-2">{description ? <EntryLink entryId={entry.id} className="line-clamp-2">{description}</EntryLink> : <span className="text-muted-foreground">—</span>}</td>
                              <td className="px-3 py-2"><EntryLink entryId={entry.id}>{line.account_code}</EntryLink></td>
                              <td className="px-3 py-2"><EntryLink entryId={entry.id}>{line.account_name}</EntryLink></td>
                              <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">{line.debit !== '0.0000' ? <EntryLink entryId={entry.id}>{fmtMoney(line.debit)}</EntryLink> : ''}</td>
                              <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">{line.credit !== '0.0000' ? <EntryLink entryId={entry.id}>{fmtMoney(line.credit)}</EntryLink> : ''}</td>
                            </tr>
                          );
                        })}
                        <tr className={`border-b-2 font-semibold ${voided ? 'opacity-60' : ''}`}>
                          <td colSpan={7} className="px-3 py-2 text-right"><EntryLink entryId={entry.id}>Total for {entry.reference || formatJournalSource(entry.source_type)}</EntryLink></td>
                          <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums"><EntryLink entryId={entry.id}>{fmtMoney(entryReport.totals.debit)}</EntryLink></td>
                          <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums"><EntryLink entryId={entry.id}>{fmtMoney(entryReport.totals.credit)}</EntryLink></td>
                        </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 bg-muted/30 font-bold">
                    <td colSpan={7} className="px-3 py-3 text-right">Report total</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-mono tabular-nums">{fmtMoney(report.totals.debit)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-mono tabular-nums">{fmtMoney(report.totals.credit)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => !importing && setImportOpen(false)} />
          <div className="relative flex max-h-[80vh] w-[700px] flex-col rounded-lg bg-background shadow-xl">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h2 className="text-lg font-semibold">Import Journal Entries from Excel</h2>
              <button onClick={() => !importing && setImportOpen(false)} className="text-lg text-muted-foreground hover:text-foreground" aria-label="Close">×</button>
            </div>
            <div className="flex-1 space-y-4 overflow-auto p-6">
              {importRows.length === 0 ? (
                <div
                  className={`flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed p-10 text-muted-foreground transition-colors ${dragOver ? 'border-primary bg-primary/5' : 'hover:border-primary/50'}`}
                  onDragOver={event => { event.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={event => { event.preventDefault(); setDragOver(false); const file = event.dataTransfer.files[0]; if (file) parseFile(file); }}
                  onClick={() => { const input = document.createElement('input'); input.type = 'file'; input.accept = '.xlsx,.xls,.csv'; input.onchange = () => { if (input.files?.[0]) parseFile(input.files[0]); }; input.click(); }}
                >
                  <Upload className="h-8 w-8" />
                  <p className="font-medium">Drop your file here or click to browse</p>
                  <p className="text-xs">Accepts .xlsx, .xls, .csv</p>
                  <p className="mt-1 text-xs">Required columns: <code>entry_date</code>, <code>account_code</code>, <code>debit</code>, <code>credit</code></p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-b">
                    <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      <th className="p-2 text-left">Date</th><th className="p-2 text-left">Account</th><th className="p-2 text-right">Debit</th><th className="p-2 text-right">Credit</th><th className="p-2 text-left">Description</th><th className="p-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importRows.map((row, index) => (
                      <tr key={index} className="border-b">
                        <td className="p-2">{row.entry_date}</td><td className="p-2">{row.account_code}</td><td className="p-2 text-right font-mono">{row.debit}</td><td className="p-2 text-right font-mono">{row.credit}</td><td className="max-w-[140px] truncate p-2 text-muted-foreground">{row.description}</td>
                        <td className="p-2">{row._status === 'imported' ? <span className="text-xs font-medium text-emerald-600">✓ Imported</span> : row._status === 'error' ? <span className="text-xs text-destructive" title={row._err}>× Error</span> : <span className="text-xs text-muted-foreground">Pending</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="flex items-center justify-between border-t px-6 py-4">
              <button className="text-sm text-muted-foreground hover:underline" onClick={() => setImportRows([])} disabled={importing}>Clear</button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => !importing && setImportOpen(false)} disabled={importing}>{importDone ? 'Close' : 'Cancel'}</Button>
                {importRows.length > 0 && !importDone && <Button onClick={runImport} disabled={importing}>{importing ? 'Importing…' : `Import ${importRows.length} rows`}</Button>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
