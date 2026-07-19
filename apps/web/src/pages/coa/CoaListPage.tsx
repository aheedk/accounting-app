import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, FileDown, Printer } from 'lucide-react';
import * as XLSX from 'xlsx';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { downloadAsExcel } from '@/lib/download';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';

const IMPORT_COLS = [
  { key: 'name', header: 'Name', required: true },
  { key: 'code', header: 'Code', required: true },
  { key: 'account_type', header: 'Account Type', required: true },
];

interface ImportRow {
  data: Record<string, string>;
  status: 'pending' | 'ok' | 'error';
  error: string | null;
}

type Account = { id: string; code: string; name: string; account_type: string; is_system: boolean; is_active: boolean };

const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;

function statusBadge(active: boolean) {
  const base = 'inline-flex rounded-full px-2 py-0.5 text-xs font-medium';
  return active
    ? <span className={`${base} bg-emerald-100 text-emerald-800`}>Active</span>
    : <span className={`${base} bg-muted text-muted-foreground`}>Inactive</span>;
}

export default function CoaListPage() {
  const [bizId] = useActiveBusinessId();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', account_type: 'asset' });
  const [err, setErr] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [excelBusy, setExcelBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState('active');
  const [search, setSearch] = useState('');

  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [showImport, setShowImport] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importBusy, setImportBusy] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const [importParseErr, setImportParseErr] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);

  async function reload() {
    if (!bizId) return;
    const r = await api.get(`/businesses/${bizId}/coa?include_inactive=true`);
    setAccounts(r.data.accounts);
  }
  useEffect(() => { void reload(); }, [bizId]);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await api.post(`/businesses/${bizId}/coa`, { ...form, parent_id: null });
      setForm({ code: '', name: '', account_type: 'asset' });
      setShowCreate(false);
      await reload();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed');
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return accounts.filter(a => {
      if (typeFilter && a.account_type !== typeFilter) return false;
      if (statusFilter === 'active' && !a.is_active) return false;
      if (statusFilter === 'inactive' && a.is_active) return false;
      if (q && !a.name.toLowerCase().includes(q) && !a.code.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [accounts, typeFilter, statusFilter, search]);

  function handleExport() {
    setExcelBusy(true);
    try {
      const headers = ['Code', 'Name', 'Type', 'Status', 'System'];
      const rows = filtered.map(a => [a.code, a.name, a.account_type, a.is_active ? 'active' : 'inactive', a.is_system ? 'yes' : 'no']);
      downloadAsExcel(headers, rows, 'chart-of-accounts');
    } finally {
      setExcelBusy(false);
    }
  }

  function handlePrint() {
    const rows = filtered.map(a => `
      <tr>
        <td>${a.code}</td>
        <td>${a.name}</td>
        <td style="text-transform:capitalize">${a.account_type}</td>
        <td style="text-transform:capitalize">${a.is_active ? 'active' : 'inactive'}</td>
        <td>${a.is_system ? 'yes' : 'no'}</td>
      </tr>`).join('');
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>Chart of Accounts</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 12px; margin: 24px; }
        h2 { margin-bottom: 4px; }
        p { color: #666; font-size: 11px; margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #f0f0f0; text-align: left; padding: 6px 8px; border-bottom: 2px solid #ccc; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
        td { padding: 5px 8px; border-bottom: 1px solid #e5e5e5; }
        tr:last-child td { border-bottom: none; }
      </style></head><body>
      <h2>Chart of Accounts</h2>
      <p>Generated ${new Date().toLocaleDateString()}</p>
      <table>
        <thead><tr><th>Code</th><th>Name</th><th>Type</th><th>Status</th><th>System</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <script>window.onload = function(){ window.print(); }<\/script>
    </body></html>`);
    win.document.close();
  }

  function handleImportFile(file: File) {
    setImportParseErr(null);
    setImportDone(false);
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const wb = XLSX.read(ev.target?.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0] ?? ''];
        if (!ws) { setImportParseErr('No sheet found in file.'); return; }
        const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
        if (raw.length === 0) { setImportParseErr('The sheet is empty.'); return; }
        const colMap: Record<string, string> = {};
        IMPORT_COLS.forEach(c => { colMap[c.header.toLowerCase()] = c.key; });
        const parsed: ImportRow[] = raw.map(r => {
          const row: Record<string, string> = {};
          for (const [k, v] of Object.entries(r)) {
            const mapped = colMap[k.trim().toLowerCase()];
            if (mapped) row[mapped] = String(v ?? '').trim();
          }
          const missing = IMPORT_COLS.filter(c => c.required && !row[c.key]);
          return { data: row, status: 'pending', error: missing.length ? `Missing: ${missing.map(c => c.header).join(', ')}` : null };
        });
        setImportRows(parsed);
      } catch {
        setImportParseErr('Could not read file.');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function handleImportFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (importFileRef.current) importFileRef.current.value = '';
    if (file) handleImportFile(file);
  }

  async function runImport() {
    setImportBusy(true);
    const updated = [...importRows];
    for (let i = 0; i < updated.length; i++) {
      const row = updated[i]!;
      if (row.error) { row.status = 'error'; continue; }
      try {
        // eslint-disable-next-line no-await-in-loop
        await api.post(`/businesses/${bizId}/coa`, {
          code: row.data['code'],
          name: row.data['name'],
          account_type: row.data['account_type'],
          parent_id: null,
        });
        row.status = 'ok';
      } catch (e: unknown) {
        row.status = 'error';
        row.error = (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Import failed';
      }
      setImportRows([...updated]);
    }
    setImportBusy(false);
    setImportDone(true);
    void reload();
  }

  function downloadSampleTemplate() {
    downloadAsExcel(
      ['Name', 'Code', 'Account Type'],
      [['Cash', '1000', 'asset'], ['Revenue', '4000', 'revenue'], ['Accounts Payable', '2000', 'liability']],
      'coa-template'
    );
  }

  const columns: Column<Account>[] = [
    { key: 'code', header: 'Code', sortable: true, sortValue: r => r.code, render: r => <span className="font-mono text-muted-foreground">{r.code}</span> },
    { key: 'name', header: 'Name', sortable: true, sortValue: r => r.name, render: r => <span className="font-medium">{r.name}</span> },
    { key: 'account_type', header: 'Type', sortable: true, sortValue: r => r.account_type, render: r => <span className="capitalize">{r.account_type}</span> },
    { key: 'status', header: 'Status', sortable: true, sortValue: r => r.is_active ? 'active' : 'inactive', render: r => statusBadge(r.is_active) },
    { key: 'system', header: 'Source', sortable: true, sortValue: r => r.is_system ? 'system' : 'user', render: r => <span className="text-muted-foreground">{r.is_system ? 'System' : 'User'}</span> },
  ];

  const validImportCount = importRows.filter(r => !r.error).length;
  const successImportCount = importRows.filter(r => r.status === 'ok').length;
  const errorImportCount = importRows.filter(r => r.status === 'error').length;

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <div className="space-y-4">

      {/* Header: title + split New account button */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Chart of Accounts</h1>
        <div className="flex items-center gap-2">
          <div className="relative group">
            <button
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
              onClick={handleExport}
              disabled={excelBusy}
              aria-label="Export Chart of Accounts"
            >
              <FileDown className="h-4 w-4" />
            </button>
            <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
              Export Chart of Accounts
            </div>
          </div>
          <div className="relative group">
            <button
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              onClick={handlePrint}
              aria-label="Print"
            >
              <Printer className="h-4 w-4" />
            </button>
            <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
              Print
            </div>
          </div>
          <div className="flex items-center" ref={dropdownRef}>
            <Button
              className="rounded-r-none border-r border-primary-foreground/20"
              onClick={() => { setErr(null); setShowCreate(true); }}
            >
              New account
            </Button>
            <div className="relative">
              <Button className="rounded-l-none px-2" onClick={() => setShowDropdown(d => !d)}>
                <ChevronDown className="h-4 w-4" />
              </Button>
              {showDropdown && (
                <div className="absolute right-0 top-full mt-1 w-56 rounded-md border bg-background shadow-lg z-50 py-1">
                  <button
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-accent"
                    onClick={() => { setShowDropdown(false); setImportRows([]); setImportDone(false); setImportParseErr(null); setShowImport(true); }}
                  >
                    Import chart of accounts
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <div className="mb-1 text-xs text-muted-foreground">Account type</div>
          <select className="h-9 rounded-md border bg-background px-3 text-sm" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
            <option value="">All types</option>
            {ACCOUNT_TYPES.map(t => <option key={t} value={t} className="capitalize">{t}</option>)}
          </select>
        </div>
        <div>
          <div className="mb-1 text-xs text-muted-foreground">Status</div>
          <select className="h-9 rounded-md border bg-background px-3 text-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </select>
        </div>
        <div className="min-w-[14rem] flex-1">
          <div className="mb-1 text-xs text-muted-foreground">Search</div>
          <Input className="h-9" placeholder="Search by name or number" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>


      <Card><CardContent className="p-0">
        <DataTable
          rows={filtered}
          getRowId={r => r.id}
          columns={columns}
          defaultSortKey="code"
          defaultSortDir="asc"
          emptyMessage={<EmptyState title="No accounts found" hint="Adjust the filters above, import accounts, or add a new account to your chart." />}
        />
      </CardContent></Card>

      {/* New account — right-side drawer */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/20" onClick={() => setShowCreate(false)} />
          <div className="w-96 bg-background shadow-xl flex flex-col border-l">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h2 className="text-lg font-semibold">New account</h2>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground text-lg"
                onClick={() => setShowCreate(false)}
              >
                ✕
              </button>
            </div>
            <form className="flex flex-col flex-1 overflow-hidden" onSubmit={create}>
              <div className="flex-1 overflow-auto p-6 space-y-4">
                <div>
                  <Label>Account name <span className="text-destructive">*</span></Label>
                  <Input
                    className="mt-1"
                    placeholder="e.g. Cash"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    required
                    autoFocus
                  />
                </div>
                <div>
                  <Label>Account type <span className="text-destructive">*</span></Label>
                  <select
                    className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={form.account_type}
                    onChange={e => setForm(f => ({ ...f, account_type: e.target.value }))}
                  >
                    {ACCOUNT_TYPES.map(t => (
                      <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>Account code</Label>
                  <Input
                    className="mt-1"
                    placeholder="e.g. 1000"
                    value={form.code}
                    onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
                  />
                </div>
                {err && <p className="text-sm text-destructive">{err}</p>}
              </div>
              <div className="border-t px-6 py-4 flex items-center justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
                <Button type="submit">Save</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import chart of accounts modal */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-background rounded-lg shadow-xl w-full max-w-2xl mx-4 flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h2 className="text-lg font-semibold">
                {importRows.length === 0
                  ? 'Import a chart of accounts'
                  : importDone
                    ? `Done — ${successImportCount} imported, ${errorImportCount} failed`
                    : `${validImportCount} of ${importRows.length} rows ready to import`}
              </h2>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground text-xl"
                onClick={() => { setShowImport(false); setImportRows([]); setImportDone(false); }}
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-auto p-6">
              <input
                ref={importFileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={handleImportFileChange}
              />

              {importRows.length === 0 ? (
                <div
                  className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center cursor-pointer transition-colors ${dropActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/30 hover:border-primary/50'}`}
                  onClick={() => importFileRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); setDropActive(true); }}
                  onDragLeave={() => setDropActive(false)}
                  onDrop={e => {
                    e.preventDefault();
                    setDropActive(false);
                    const file = e.dataTransfer.files[0];
                    if (file) handleImportFile(file);
                  }}
                >
                  <svg className="mb-3 h-10 w-10 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <p className="text-sm">
                    Drag and drop or{' '}
                    <span className="font-medium text-primary underline">select files</span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">Use file type .csv, .xls, or .xlsx</p>
                  {importParseErr && <p className="mt-3 text-sm text-destructive">{importParseErr}</p>}
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40">
                    <tr>
                      <th className="p-2 text-left w-8">#</th>
                      {IMPORT_COLS.map(c => <th key={c.key} className="p-2 text-left">{c.header}</th>)}
                      <th className="p-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importRows.map((row, i) => (
                      <tr key={i} className="border-b last:border-b-0">
                        <td className="p-2 text-muted-foreground">{i + 1}</td>
                        {IMPORT_COLS.map(c => (
                          <td key={c.key} className="p-2 truncate max-w-[150px]">{row.data[c.key] ?? ''}</td>
                        ))}
                        <td className="p-2 whitespace-nowrap">
                          {row.status === 'ok' && <span className="text-emerald-600 font-medium">✓ Imported</span>}
                          {row.status === 'error' && <span className="text-destructive text-xs">{row.error ?? 'Error'}</span>}
                          {row.status === 'pending' && row.error && <span className="text-amber-600 text-xs">{row.error}</span>}
                          {row.status === 'pending' && !row.error && <span className="text-muted-foreground">Ready</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="border-t px-6 py-4 flex items-center justify-between gap-3">
              <button
                type="button"
                className="text-sm text-primary underline hover:no-underline"
                onClick={downloadSampleTemplate}
              >
                Download sample template
              </button>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => { setShowImport(false); setImportRows([]); setImportDone(false); }}
                >
                  Cancel
                </Button>
                {importRows.length === 0 && (
                  <Button onClick={() => importFileRef.current?.click()}>
                    Next
                  </Button>
                )}
                {importRows.length > 0 && !importDone && (
                  <Button onClick={() => void runImport()} disabled={importBusy || validImportCount === 0}>
                    {importBusy ? 'Importing…' : `Import ${validImportCount} record${validImportCount === 1 ? '' : 's'}`}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
