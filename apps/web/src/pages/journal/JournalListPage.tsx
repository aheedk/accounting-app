import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Settings, Upload } from 'lucide-react';
import * as XLSX from 'xlsx';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { parseMoneyInput } from '@/lib/money';
import { pickErr } from '@/lib/apiErrors';

type JE = { id: string; entry_date: string; memo: string | null; status: string; source_type: string };
type ImportRow = { entry_date: string; account_code: string; debit: string; credit: string; description: string; _status?: string; _err?: string };

function fmtShortDate(iso: string) {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}


function statusBadge(status: string) {
  const base = 'inline-flex rounded-full px-2 py-0.5 text-xs font-medium';
  switch (status) {
    case 'draft':
      return <span className={`${base} bg-amber-100 text-amber-800`}>Draft</span>;
    case 'posted':
      return <span className={`${base} bg-emerald-100 text-emerald-800`}>Posted</span>;
    case 'void':
    case 'voided':
      return <span className={`${base} bg-muted text-muted-foreground`}>Void</span>;
    default:
      return <span className={`${base} capitalize`}>{status}</span>;
  }
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'posted', label: 'Posted' },
  { value: 'void', label: 'Void' },
];

export default function JournalListPage() {
  const [bizId] = useActiveBusinessId();
  const [entries, setEntries] = useState<JE[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/journal-entries`).then(r => setEntries(r.data.entries));
  }, [bizId]);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setDropdownOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  function parseFile(file: File) {
    const reader = new FileReader();
    reader.onload = ev => {
      const data = new Uint8Array(ev.target!.result as ArrayBuffer);
      const wb = XLSX.read(data, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]!];
      if (!ws) return;
      const raw = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '' });
      const rows: ImportRow[] = raw.map(r => ({
        entry_date: String(r['entry_date'] ?? r['date'] ?? r['Date'] ?? ''),
        account_code: String(r['account_code'] ?? r['account'] ?? r['Account'] ?? ''),
        debit: String(r['debit'] ?? r['Debit'] ?? '0'),
        credit: String(r['credit'] ?? r['Credit'] ?? '0'),
        description: String(r['description'] ?? r['Description'] ?? r['memo'] ?? ''),
      }));
      setImportRows(rows);
      setImportDone(false);
    };
    reader.readAsArrayBuffer(file);
  }

  async function runImport() {
    if (!bizId || importRows.length === 0) return;
    setImporting(true);
    const updated = [...importRows];
    for (let i = 0; i < updated.length; i++) {
      const row = updated[i]!;
      try {
        await api.post(`/businesses/${bizId}/journal-entries`, {
          entry_date: row.entry_date,
          memo: row.description || null,
          lines: [
            { account_id: row.account_code, debit: parseMoneyInput(row.debit || '0'), credit: parseMoneyInput(row.credit || '0'), memo: row.description || null },
          ],
        });
        updated[i] = { ...row, _status: 'imported' };
      } catch (e: unknown) {
        updated[i] = { ...row, _status: 'error', _err: pickErr(e) };
      }
      setImportRows([...updated]);
    }
    setImporting(false);
    setImportDone(true);
    api.get(`/businesses/${bizId}/journal-entries`).then(r => setEntries(r.data.entries));
  }

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter(e => {
      if (statusFilter !== 'all' && e.status !== statusFilter) return false;
      if (q && !(e.memo ?? '').toLowerCase().includes(q) && !e.source_type.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [entries, statusFilter, search]);

  const columns: Column<JE>[] = [
    { key: 'entry_date', header: 'Date', sortable: true, sortValue: r => Date.parse(r.entry_date), render: r => <span className="whitespace-nowrap">{fmtShortDate(r.entry_date)}</span> },
    { key: 'memo', header: 'Memo', sortable: true, sortValue: r => r.memo ?? '', render: r => r.memo ? <span className="font-medium">{r.memo}</span> : <span className="text-muted-foreground">—</span> },
    { key: 'source_type', header: 'Source', sortable: true, sortValue: r => r.source_type, render: r => <span className="capitalize text-muted-foreground">{r.source_type.replace(/_/g, ' ')}</span> },
    { key: 'status', header: 'Status', sortable: true, sortValue: r => r.status, render: r => statusBadge(r.status) },
  ];

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Journal Entries</h1>

        {/* Split button */}
        <div className="flex" ref={dropdownRef}>
          <Button asChild className="rounded-r-none">
            <Link to="/journal/new">New entry</Link>
          </Button>
          <button
            onClick={() => setDropdownOpen(o => !o)}
            className="flex items-center justify-center rounded-r-md rounded-l-none border border-l-0 border-primary bg-primary px-2 text-primary-foreground hover:bg-primary/90 transition-colors"
            aria-label="More options"
          >
            <ChevronDown className="h-4 w-4" />
          </button>

          {dropdownOpen && (
            <div className="absolute right-0 mt-10 w-52 rounded-md border bg-popover shadow-lg z-50 py-1">
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

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <div className="mb-1 text-xs text-muted-foreground">Status</div>
          <select className="h-9 rounded-md border bg-background px-3 text-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="min-w-[14rem] flex-1">
          <div className="mb-1 text-xs text-muted-foreground">Search</div>
          <Input className="h-9" placeholder="Search by memo or source" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      <Card><CardContent className="p-0">
        <DataTable
          rows={rows}
          getRowId={r => r.id}
          columns={columns}
          defaultSortKey="entry_date"
          defaultSortDir="desc"
          downloadable={{ filename: 'journal-entries', title: 'Journal Entries' }}
          actionsHeader={<span className="inline-flex items-center gap-1.5">Action <Settings className="h-3.5 w-3.5" /></span>}
          actions={r => (
            <span className="inline-flex items-center gap-2">
              <Link className="text-primary hover:underline" to={`/journal/${r.id}`}>View/Edit</Link>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </span>
          )}
          emptyMessage={<EmptyState title="No journal entries found" hint="Adjust the filters above, import entries, or record a manual journal entry." actionLabel="New entry" actionTo="/journal/new" />}
        />
      </CardContent></Card>

      {/* Import modal */}
      <Dialog open={importOpen} onOpenChange={(open) => { if (!importing) setImportOpen(open); }}>
        <DialogContent className="max-w-[700px] max-h-[80vh] flex flex-col">
          <DialogHeader><DialogTitle>Import Journal Entries from Excel</DialogTitle></DialogHeader>

          <div className="flex-1 overflow-auto p-6 space-y-4">
              {importRows.length === 0 ? (
                <div
                  className={`border-2 border-dashed rounded-lg p-10 flex flex-col items-center gap-3 text-muted-foreground cursor-pointer transition-colors ${dragOver ? 'border-primary bg-primary/5' : 'hover:border-primary/50'}`}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) parseFile(f); }}
                  onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xlsx,.xls,.csv'; inp.onchange = () => { if (inp.files?.[0]) parseFile(inp.files[0]); }; inp.click(); }}
                >
                  <Upload className="h-8 w-8" />
                  <p className="font-medium">Drop your file here or click to browse</p>
                  <p className="text-xs">Accepts .xlsx, .xls, .csv</p>
                  <p className="text-xs mt-1">Required columns: <code>entry_date</code>, <code>account_code</code>, <code>debit</code>, <code>credit</code></p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-b">
                    <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      <th className="p-2 text-left">Date</th>
                      <th className="p-2 text-left">Account</th>
                      <th className="p-2 text-right">Debit</th>
                      <th className="p-2 text-right">Credit</th>
                      <th className="p-2 text-left">Description</th>
                      <th className="p-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importRows.map((row, i) => (
                      <tr key={i} className="border-b">
                        <td className="p-2">{row.entry_date}</td>
                        <td className="p-2">{row.account_code}</td>
                        <td className="p-2 text-right font-mono">{row.debit}</td>
                        <td className="p-2 text-right font-mono">{row.credit}</td>
                        <td className="p-2 text-muted-foreground truncate max-w-[140px]">{row.description}</td>
                        <td className="p-2">
                          {row._status === 'imported' && <span className="text-emerald-600 text-xs font-medium">✓ Imported</span>}
                          {row._status === 'error' && <span className="text-destructive text-xs" title={row._err}>✗ Error</span>}
                          {!row._status && <span className="text-muted-foreground text-xs">Pending</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

          <DialogFooter className="justify-between">
            <button
              className="text-sm text-muted-foreground hover:underline"
              onClick={() => setImportRows([])}
              disabled={importing}
            >
              Clear
            </button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => !importing && setImportOpen(false)} disabled={importing}>
                {importDone ? 'Close' : 'Cancel'}
              </Button>
              {importRows.length > 0 && !importDone && (
                <Button onClick={runImport} disabled={importing}>
                  {importing ? 'Importing…' : `Import ${importRows.length} rows`}
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
