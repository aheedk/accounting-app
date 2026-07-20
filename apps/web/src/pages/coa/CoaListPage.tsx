import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, FileDown, Pencil, Printer, Search, Settings2, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { downloadAsExcel } from '@/lib/download';
import { fmtMoney } from '@/lib/money';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const IMPORT_COLS = [
  { key: 'name', header: 'Name', required: true },
  { key: 'code', header: 'Code', required: true },
  { key: 'account_type', header: 'Account Type', required: true },
];

const COL_ALIASES: Record<string, string> = {
  'name': 'name',
  'account name': 'name',
  'acct name': 'name',
  'code': 'code',
  'no.': 'code',
  'no': 'code',
  '#': 'code',
  'number': 'code',
  'account code': 'code',
  'acct code': 'code',
  'account type': 'account_type',
  'type': 'account_type',
  'account_type': 'account_type',
  'acct type': 'account_type',
};

const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;

const DETAIL_TYPES: Record<string, string[]> = {
  asset: ['Checking', 'Savings', 'Money Market', 'Cash on Hand', 'Accounts Receivable', 'Prepaid Expenses', 'Inventory', 'Fixed Assets', 'Buildings', 'Vehicles', 'Equipment', 'Accumulated Depreciation', 'Other Assets'],
  liability: ['Accounts Payable', 'Credit Card', 'Line of Credit', 'Loan Payable', 'Sales Tax Payable', 'Accrued Liabilities', 'Customer Deposits', 'Notes Payable', 'Mortgage', 'Other Liabilities'],
  equity: ['Opening Balance Equity', 'Retained Earnings', 'Common Stock', 'Partner Contributions', 'Partner Distributions', 'Paid-In Capital', 'Other Equity'],
  revenue: ['Sales Income', 'Service Income', 'Interest Earned', 'Dividend Income', 'Other Income', 'Discounts Given'],
  expense: ['Advertising', 'Auto', 'Bank Charges', 'Cost of Labor', 'Dues & Subscriptions', 'Equipment Rental', 'Insurance', 'Legal & Professional Fees', 'Meals & Entertainment', 'Office Expenses', 'Payroll Expenses', 'Rent', 'Repairs & Maintenance', 'Taxes & Licenses', 'Travel', 'Utilities', 'Other Expenses'],
};

const PAGE_SIZE = 50;

interface ImportRow {
  data: Record<string, string>;
  status: 'pending' | 'ok' | 'error';
  error: string | null;
}

type Account = {
  id: string;
  code: string;
  name: string;
  account_type: string;
  parent_id: string | null;
  detail_type: string | null;
  description: string | null;
  is_system: boolean;
  is_active: boolean;
};

export default function CoaListPage() {
  const [bizId] = useActiveBusinessId();
  const [accounts, setAccounts] = useState<Account[]>([]);

  // Filters + pagination
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  // Settings panel
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const [colType, setColType] = useState(false);
  const [colDetailType, setColDetailType] = useState(false);
  const [colDescription, setColDescription] = useState(false);
  const [colQBBalance, setColQBBalance] = useState(false);
  const [colBankBalance, setColBankBalance] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [showReportBadges, setShowReportBadges] = useState(false);
  const [pageSize, setPageSize] = useState(50);
  const [density, setDensity] = useState<'roomy' | 'comfortable' | 'cozy' | 'compact'>('cozy');

  // Checkbox selection
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [showBatchMenu, setShowBatchMenu] = useState(false);
  const batchMenuRef = useRef<HTMLDivElement>(null);

  // New account dropdown
  const [showNewDropdown, setShowNewDropdown] = useState(false);
  const newDropdownRef = useRef<HTMLDivElement>(null);

  // Row action menu
  const [openRowMenu, setOpenRowMenu] = useState<string | null>(null);

  // Create drawer
  const [showCreate, setShowCreate] = useState(false);
  const [createParentId, setCreateParentId] = useState<string | null>(null);
  const [form, setForm] = useState({ code: '', name: '', account_type: 'asset', detail_type: '', description: '' });
  const [createErr, setCreateErr] = useState<string | null>(null);

  // Edit slide-over
  const [editAccount, setEditAccount] = useState<Account | null>(null);
  const [editForm, setEditForm] = useState({ name: '', detail_type: '', description: '', parent_id: null as string | null, is_subaccount: false });
  const [editBalance, setEditBalance] = useState<string | null>(null);
  const [editErr, setEditErr] = useState<string | null>(null);
  const [editBusy, setEditBusy] = useState(false);

  // Excel export
  const [excelBusy, setExcelBusy] = useState(false);

  // Import modal
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

  // Reset page when filters change
  useEffect(() => { setPage(0); }, [typeFilter, statusFilter, search]);

  // Escape closes drawers
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setShowCreate(false); setEditAccount(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Click-outside: batch menu
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (batchMenuRef.current && !batchMenuRef.current.contains(e.target as Node)) setShowBatchMenu(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  // Click-outside: new account dropdown
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (newDropdownRef.current && !newDropdownRef.current.contains(e.target as Node)) setShowNewDropdown(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  // Click-outside: row menus
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (!(e.target as Element).closest('[data-row-menu]')) setOpenRowMenu(null);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  // Click-outside: settings panel
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) setSettingsOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  // --- Filter + paginate ---
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const effectiveStatus = showInactive ? 'all' : statusFilter;
    return accounts.filter(a => {
      if (typeFilter && a.account_type !== typeFilter) return false;
      if (effectiveStatus === 'active' && !a.is_active) return false;
      if (effectiveStatus === 'inactive' && a.is_active) return false;
      if (q && !a.name.toLowerCase().includes(q) && !a.code.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [accounts, typeFilter, statusFilter, search, showInactive]);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const pagedAccounts = useMemo(() => filtered.slice(page * pageSize, (page + 1) * pageSize), [filtered, page, pageSize]);
  const startNum = filtered.length === 0 ? 0 : page * pageSize + 1;
  const endNum = Math.min((page + 1) * pageSize, filtered.length);

  // --- Checkbox helpers ---
  function toggleCheck(id: string) {
    setCheckedIds(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  }
  function toggleAll() {
    const allIds = pagedAccounts.map(a => a.id);
    const allChecked = allIds.every(id => checkedIds.has(id));
    setCheckedIds(allChecked ? new Set() : new Set(allIds));
  }

  // --- Batch actions ---
  async function batchMakeInactive() {
    const ids = [...checkedIds];
    for (const id of ids) {
      try { await api.patch(`/businesses/${bizId}/coa/${id}`, { is_active: false }); } catch { /* skip */ }
    }
    setCheckedIds(new Set());
    setShowBatchMenu(false);
    await reload();
  }

  // --- Create ---
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreateErr(null);
    try {
      await api.post(`/businesses/${bizId}/coa`, {
        code: form.code,
        name: form.name,
        account_type: form.account_type,
        detail_type: form.detail_type || null,
        description: form.description || null,
        parent_id: createParentId,
      });
      setForm({ code: '', name: '', account_type: 'asset', detail_type: '', description: '' });
      setCreateParentId(null);
      setShowCreate(false);
      await reload();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      setCreateErr(msg ?? 'Failed');
    }
  }

  // --- Edit ---
  function openEdit(acct: Account) {
    setEditAccount(acct);
    setEditForm({
      name: acct.name,
      detail_type: acct.detail_type ?? '',
      description: acct.description ?? '',
      parent_id: acct.parent_id,
      is_subaccount: !!acct.parent_id,
    });
    setEditBalance(null);
    setEditErr(null);
    if (bizId) {
      api.get(`/businesses/${bizId}/coa/${acct.id}`)
        .then(r => setEditBalance(String(r.data.balance ?? '0')))
        .catch(() => setEditBalance('0'));
    }
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editAccount || !bizId) return;
    setEditErr(null);
    setEditBusy(true);
    try {
      const r = await api.patch(`/businesses/${bizId}/coa/${editAccount.id}`, {
        name: editForm.name,
        detail_type: editForm.detail_type || null,
        description: editForm.description || null,
        parent_id: editForm.is_subaccount ? (editForm.parent_id ?? null) : null,
      });
      setAccounts(prev => prev.map(a => a.id === editAccount.id ? { ...a, ...r.data } : a));
      setEditAccount(null);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      setEditErr(msg ?? 'Failed to save');
    } finally {
      setEditBusy(false);
    }
  }

  // --- Make inactive / active ---
  async function toggleActive(acct: Account) {
    try {
      const r = await api.patch(`/businesses/${bizId}/coa/${acct.id}`, { is_active: !acct.is_active });
      setAccounts(prev => prev.map(a => a.id === acct.id ? { ...a, is_active: r.data.is_active } : a));
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      window.alert(msg ?? 'Failed');
    }
  }

  // --- Export / Print ---
  function handleExport() {
    setExcelBusy(true);
    try {
      downloadAsExcel(
        ['Code', 'Name', 'Type', 'Detail Type', 'Status'],
        filtered.map(a => [a.code, a.name, a.account_type, a.detail_type ?? '', a.is_active ? 'active' : 'inactive']),
        'chart-of-accounts'
      );
    } finally { setExcelBusy(false); }
  }

  function handlePrint() {
    const rows = filtered.map(a => `<tr><td>${a.code}</td><td>${a.name}</td><td style="text-transform:capitalize">${a.account_type}</td><td>${a.detail_type ?? ''}</td><td>${a.is_active ? 'active' : 'inactive'}</td></tr>`).join('');
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>Chart of Accounts</title><style>body{font-family:Arial,sans-serif;font-size:12px;margin:24px}h2{margin-bottom:4px}p{color:#666;font-size:11px;margin-bottom:16px}table{width:100%;border-collapse:collapse}th{background:#f0f0f0;text-align:left;padding:6px 8px;border-bottom:2px solid #ccc;font-size:11px;text-transform:uppercase}td{padding:5px 8px;border-bottom:1px solid #e5e5e5}</style></head><body><h2>Chart of Accounts</h2><p>Generated ${new Date().toLocaleDateString()}</p><table><thead><tr><th>Code</th><th>Name</th><th>Type</th><th>Detail Type</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table><script>window.onload=function(){window.print()}<\/script></body></html>`);
    win.document.close();
  }

  // --- Import ---
  function handleImportFile(file: File) {
    setImportParseErr(null); setImportDone(false);
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const wb = XLSX.read(ev.target?.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0] ?? ''];
        if (!ws) { setImportParseErr('No sheet found in file.'); return; }
        const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
        if (raw.length === 0) { setImportParseErr('The sheet is empty.'); return; }
        const parsed: ImportRow[] = raw.map(r => {
          const row: Record<string, string> = {};
          for (const [k, v] of Object.entries(r)) {
            const mapped = COL_ALIASES[k.trim().toLowerCase()];
            if (mapped) row[mapped] = String(v ?? '').trim();
          }
          const missing = IMPORT_COLS.filter(c => c.required && !row[c.key]);
          return { data: row, status: 'pending', error: missing.length ? `Missing: ${missing.map(c => c.header).join(', ')}` : null };
        });
        setImportRows(parsed);
      } catch { setImportParseErr('Could not read file.'); }
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
        await api.post(`/businesses/${bizId}/coa`, { code: row.data['code'], name: row.data['name'], account_type: row.data['account_type'], parent_id: null });
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
    downloadAsExcel(['Name', 'Code', 'Account Type'], [['Cash', '1000', 'asset'], ['Revenue', '4000', 'revenue'], ['Accounts Payable', '2000', 'liability']], 'coa-template');
  }

  const validImportCount = importRows.filter(r => !r.error).length;
  const successImportCount = importRows.filter(r => r.status === 'ok').length;
  const errorImportCount = importRows.filter(r => r.status === 'error').length;
  const allPageChecked = pagedAccounts.length > 0 && pagedAccounts.every(a => checkedIds.has(a.id));
  const parentChoices = accounts.filter(a => a.id !== editAccount?.id && a.is_active);

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <div className="space-y-4">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Chart of accounts</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link to="/reports/trial-balance">Run report</Link>
          </Button>
          <div className="flex items-center" ref={newDropdownRef}>
            <Button
              className="rounded-r-none border-r border-primary-foreground/20"
              onClick={() => { setCreateErr(null); setCreateParentId(null); setForm({ code: '', name: '', account_type: 'asset', detail_type: '', description: '' }); setShowCreate(true); }}
            >
              New account
            </Button>
            <div className="relative">
              <Button className="rounded-l-none px-2" onClick={() => setShowNewDropdown(d => !d)}>
                <ChevronDown className="h-4 w-4" />
              </Button>
              {showNewDropdown && (
                <div className="absolute right-0 top-full mt-1 w-56 rounded-md border bg-background shadow-lg z-50 py-1">
                  <button
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-accent"
                    onClick={() => { setShowNewDropdown(false); setImportRows([]); setImportDone(false); setImportParseErr(null); setShowImport(true); }}
                  >
                    Import chart of accounts
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Filter row ── */}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-2">
          {/* Batch actions */}
          <div className="relative" ref={batchMenuRef}>
            <button
              className="h-9 flex items-center gap-1.5 rounded-md border bg-background px-3 text-sm hover:bg-muted/50 disabled:opacity-40"
              disabled={checkedIds.size === 0}
              onClick={() => setShowBatchMenu(m => !m)}
            >
              Batch actions <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {showBatchMenu && (
              <div className="absolute left-0 top-full mt-1 w-48 rounded-md border bg-background shadow-lg z-50 py-1">
                <button className="w-full text-left px-4 py-2.5 text-sm hover:bg-accent" onClick={() => void batchMakeInactive()}>
                  Make inactive
                </button>
              </div>
            )}
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              className="h-9 pl-8 w-64"
              placeholder="Filter by name or number"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {/* Type filter */}
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
          >
            <option value="">All</option>
            {ACCOUNT_TYPES.map(t => <option key={t} value={t} className="capitalize">{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
          </select>

          {/* Status filter */}
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </select>
        </div>

        {/* Right side: Batch edit + icons + settings, then pagination below */}
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-1">
            {/* Batch edit */}
            <button
              className="inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-emerald-700 hover:bg-muted/50 disabled:opacity-40 transition-colors"
              disabled={checkedIds.size === 0}
              title={checkedIds.size === 0 ? 'Select accounts to batch edit' : 'Batch edit selected'}
            >
              <Pencil className="h-4 w-4" />
              Batch edit
            </button>

            {/* Export */}
            <div className="relative group">
              <button
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent disabled:opacity-50"
                onClick={handleExport} disabled={excelBusy} aria-label="Export to Excel"
              >
                <FileDown className="h-4 w-4" />
              </button>
              <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">Export to Excel</div>
            </div>

            {/* Print */}
            <div className="relative group">
              <button
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
                onClick={handlePrint} aria-label="Print"
              >
                <Printer className="h-4 w-4" />
              </button>
              <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">Print</div>
            </div>

            {/* Settings gear */}
            <div className="relative" ref={settingsRef}>
              <button
                className={`inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent transition-colors ${settingsOpen ? 'bg-accent text-foreground' : ''}`}
                onClick={() => setSettingsOpen(o => !o)}
                aria-label="Settings"
              >
                <Settings2 className="h-4 w-4" />
              </button>

              {settingsOpen && (
                <div className="absolute right-0 top-full mt-1 w-72 rounded-lg border bg-background shadow-xl z-50">
                  <div className="flex items-center justify-between px-4 py-3 border-b">
                    <span className="font-semibold text-sm">Settings</span>
                    <button onClick={() => setSettingsOpen(false)} className="text-muted-foreground hover:text-foreground">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="p-4 space-y-5 max-h-[70vh] overflow-y-auto">

                    {/* Columns */}
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Columns</p>
                      <div className="space-y-2">
                        {[
                          { label: 'Type', state: colType, set: setColType },
                          { label: 'Detail type', state: colDetailType, set: setColDetailType },
                          { label: 'Description', state: colDescription, set: setColDescription },
                          { label: 'QuickBooks balance', state: colQBBalance, set: setColQBBalance },
                          { label: 'Bank balance', state: colBankBalance, set: setColBankBalance },
                        ].map(({ label, state, set }) => (
                          <label key={label} className="flex items-center gap-3 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={state}
                              onChange={e => set(e.target.checked)}
                              className="h-4 w-4 rounded border-input cursor-pointer"
                            />
                            <span className="text-sm">{label}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Other */}
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Other</p>
                      <div className="space-y-2">
                        <label className="flex items-center gap-3 cursor-pointer select-none">
                          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} className="h-4 w-4 rounded border-input cursor-pointer" />
                          <span className="text-sm">Show inactive accounts</span>
                        </label>
                        <label className="flex items-center gap-3 cursor-pointer select-none">
                          <input type="checkbox" checked={showReportBadges} onChange={e => setShowReportBadges(e.target.checked)} className="h-4 w-4 rounded border-input cursor-pointer" />
                          <span className="text-sm">Show report type badges</span>
                        </label>
                      </div>
                    </div>

                    {/* Page size */}
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Page size</p>
                      <div className="space-y-2">
                        {[50, 75, 100, 200, 300].map(n => (
                          <label key={n} className="flex items-center gap-3 cursor-pointer select-none">
                            <input
                              type="radio"
                              name="pageSize"
                              checked={pageSize === n}
                              onChange={() => { setPageSize(n); setPage(0); }}
                              className="h-4 w-4 accent-emerald-600 cursor-pointer"
                            />
                            <span className="text-sm">{n}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Table density */}
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Table Density</p>
                      <div className="space-y-2">
                        {(['roomy', 'comfortable', 'cozy', 'compact'] as const).map(d => (
                          <label key={d} className="flex items-center gap-3 cursor-pointer select-none">
                            <input
                              type="radio"
                              name="density"
                              checked={density === d}
                              onChange={() => setDensity(d)}
                              className="h-4 w-4 accent-emerald-600 cursor-pointer"
                            />
                            <span className="text-sm capitalize">{d}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Pagination below icons */}
          {filtered.length > 0 && (
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <button
                className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-muted/50 disabled:opacity-40"
                disabled={page === 0}
                onClick={() => setPage(p => p - 1)}
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="px-1 tabular-nums text-xs">
                {page === 0 && totalPages <= 1 ? `1 - ${filtered.length}` : `${startNum} - ${endNum}`}
              </span>
              <button
                className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-muted/50 disabled:opacity-40"
                disabled={page >= totalPages - 1}
                onClick={() => setPage(p => p + 1)}
                aria-label="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Table ── */}
      {(() => {
        const pad = { roomy: 'py-5', comfortable: 'py-3.5', cozy: 'py-3', compact: 'py-1.5' }[density];
        const colCount = 3 + (colType ? 1 : 0) + (colDetailType ? 1 : 0) + (colDescription ? 1 : 0) + (colQBBalance ? 1 : 0) + (colBankBalance ? 1 : 0);
        const thCls = `px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide`;
        return (
      <div className="rounded-md border bg-background overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/30">
            <tr>
              <th className="w-10 px-3 py-2.5">
                <input type="checkbox" checked={allPageChecked} onChange={toggleAll} className="h-4 w-4 rounded border-input cursor-pointer" />
              </th>
              <th className={thCls}>Name</th>
              {colType && <th className={thCls}>Type</th>}
              {colDetailType && <th className={thCls}>Detail Type</th>}
              {colDescription && <th className={thCls}>Description</th>}
              {colQBBalance && <th className={`${thCls} text-right`}>QB Balance</th>}
              {colBankBalance && <th className={`${thCls} text-right`}>Bank Balance</th>}
              <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide w-48">Action</th>
            </tr>
          </thead>
          <tbody>
            {pagedAccounts.length === 0 && (
              <tr>
                <td colSpan={colCount} className="py-12 text-center text-muted-foreground text-sm">
                  No accounts found. Adjust the filters or add a new account.
                </td>
              </tr>
            )}
            {pagedAccounts.map(acct => (
              <tr key={acct.id} className={`border-b last:border-b-0 hover:bg-muted/20 group ${!acct.is_active ? 'opacity-60' : ''}`}>
                <td className={`px-3 ${pad}`}>
                  <input
                    type="checkbox"
                    checked={checkedIds.has(acct.id)}
                    onChange={() => toggleCheck(acct.id)}
                    className="h-4 w-4 rounded border-input cursor-pointer"
                  />
                </td>
                <td className={`px-3 ${pad}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{acct.name}</span>
                    {!acct.is_active && <span className="inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground">Inactive</span>}
                    {showReportBadges && (
                      <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold ${['asset','liability','equity'].includes(acct.account_type) ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300' : 'bg-purple-100 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300'}`}>
                        {['asset','liability','equity'].includes(acct.account_type) ? 'Balance Sheet' : 'Income Statement'}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono mt-0.5">{acct.code}{acct.detail_type ? ` · ${acct.detail_type}` : ''}</div>
                </td>
                {colType && <td className={`px-3 ${pad} text-sm capitalize text-muted-foreground`}>{acct.account_type}</td>}
                {colDetailType && <td className={`px-3 ${pad} text-sm text-muted-foreground`}>{acct.detail_type ?? <span className="opacity-30">—</span>}</td>}
                {colDescription && <td className={`px-3 ${pad} text-sm text-muted-foreground max-w-[200px] truncate`}>{acct.description ?? <span className="opacity-30">—</span>}</td>}
                {colQBBalance && <td className={`px-3 ${pad} text-right font-mono text-sm text-muted-foreground`}>—</td>}
                {colBankBalance && <td className={`px-3 ${pad} text-right font-mono text-sm text-muted-foreground`}>—</td>}
                <td className="px-3 py-3">
                  <div className="flex items-center justify-end gap-1" data-row-menu={acct.id}>
                    <Link
                      to={`/coa/${acct.id}/register`}
                      className="text-sm font-medium text-primary px-2 py-1 rounded hover:bg-muted/40 transition-colors"
                    >
                      View register
                    </Link>
                    <div className="relative">
                      <button
                        className="inline-flex h-8 w-8 items-center justify-center rounded border bg-muted/30 hover:bg-muted text-muted-foreground"
                        onClick={() => setOpenRowMenu(id => id === acct.id ? null : acct.id)}
                        aria-label="More actions"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                      {openRowMenu === acct.id && (
                        <div className="absolute right-0 top-full mt-1 w-52 rounded-md border bg-background shadow-lg z-50 py-1">
                          <button
                            className="w-full text-left px-4 py-2.5 text-sm hover:bg-accent"
                            onClick={() => { setOpenRowMenu(null); openEdit(acct); }}
                          >
                            Edit
                          </button>
                          <button
                            className="w-full text-left px-4 py-2.5 text-sm hover:bg-accent"
                            onClick={() => {
                              setOpenRowMenu(null);
                              setCreateParentId(acct.id);
                              setForm({ code: '', name: '', account_type: acct.account_type, detail_type: '', description: '' });
                              setCreateErr(null);
                              setShowCreate(true);
                            }}
                          >
                            Create subaccount
                          </button>
                          <button
                            className="w-full text-left px-4 py-2.5 text-sm hover:bg-accent"
                            onClick={() => { setOpenRowMenu(null); void toggleActive(acct); }}
                          >
                            {acct.is_active ? 'Make inactive (reduces usage)' : 'Make active'}
                          </button>
                          <Link
                            to={`/reports/trial-balance`}
                            className="block px-4 py-2.5 text-sm hover:bg-accent"
                            onClick={() => setOpenRowMenu(null)}
                          >
                            Run report
                          </Link>
                        </div>
                      )}
                    </div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
        );
      })()}

      {/* ── Edit slide-over ── */}
      {editAccount && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/20" onClick={() => setEditAccount(null)} />
          <div className="w-[420px] bg-background shadow-xl flex flex-col border-l" role="dialog" aria-modal="true" aria-label="Edit account">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h2 className="text-lg font-semibold">Edit account</h2>
              <button type="button" className="text-muted-foreground hover:text-foreground text-lg leading-none" onClick={() => setEditAccount(null)}>✕</button>
            </div>
            <form className="flex flex-col flex-1 overflow-hidden" onSubmit={e => void saveEdit(e)}>
              <div className="flex-1 overflow-auto p-6 space-y-4">
                <div>
                  <Label>Account name <span className="text-destructive">*</span></Label>
                  <Input
                    className="mt-1"
                    value={editForm.name}
                    onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                    required
                    disabled={editAccount.is_system}
                    autoFocus
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Account type <span className="text-destructive">*</span></Label>
                    <select
                      className="mt-1 h-10 w-full rounded-md border bg-muted/30 px-3 text-sm cursor-not-allowed opacity-70"
                      value={editAccount.account_type}
                      disabled
                    >
                      {ACCOUNT_TYPES.map(t => (
                        <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label>Detail type</Label>
                    <select
                      className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
                      value={editForm.detail_type}
                      onChange={e => setEditForm(f => ({ ...f, detail_type: e.target.value }))}
                    >
                      <option value="">— select —</option>
                      {(DETAIL_TYPES[editAccount.account_type] ?? []).map(dt => (
                        <option key={dt} value={dt}>{dt}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-input cursor-pointer"
                      checked={editForm.is_subaccount}
                      disabled={editAccount.is_system}
                      onChange={e => setEditForm(f => ({ ...f, is_subaccount: e.target.checked, parent_id: e.target.checked ? f.parent_id : null }))}
                    />
                    <span className="text-sm">Make this a subaccount</span>
                  </label>
                  {editForm.is_subaccount && (
                    <div className="pl-6">
                      <Label className="text-xs">Parent account</Label>
                      <select
                        className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
                        value={editForm.parent_id ?? ''}
                        onChange={e => setEditForm(f => ({ ...f, parent_id: e.target.value || null }))}
                      >
                        <option value="">— select parent —</option>
                        {parentChoices.map(a => (
                          <option key={a.id} value={a.id}>{a.name} ({a.code})</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <div>
                  <Label>Description</Label>
                  <textarea
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
                    rows={3}
                    value={editForm.description}
                    onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="Optional description"
                  />
                </div>

                <div className="rounded-md border bg-muted/20 px-4 py-3 text-sm">
                  <span className="text-muted-foreground">Balance: </span>
                  <span className="font-semibold font-mono">
                    {editBalance === null ? '—' : fmtMoney(editBalance)}
                  </span>
                </div>

                {/* ── Balance Sheet / Income Statement preview ── */}
                {(() => {
                  const isBalanceSheet = ['asset', 'liability', 'equity'].includes(editAccount.account_type);
                  const reportName = isBalanceSheet ? 'Balance Sheet' : 'Income Statement';
                  const reportPath = isBalanceSheet ? '/reports/balance-sheet' : '/reports/profit-loss';
                  const today = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
                  const previewAccounts = accounts
                    .filter(a => a.account_type === editAccount.account_type && (a.is_active || a.id === editAccount.id))
                    .sort((a, b) => a.code.localeCompare(b.code));
                  return (
                    <div className="border-t pt-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold text-sm">{reportName}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">Active accounts as of {today}</p>
                        </div>
                        <Link
                          to={reportPath}
                          className="shrink-0 inline-flex items-center rounded px-2.5 py-1.5 text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                          onClick={() => setEditAccount(null)}
                        >
                          EDIT ACCOUNT PREVIEW
                        </Link>
                      </div>
                      <div className="border rounded-md overflow-hidden">
                        {previewAccounts.map(a => (
                          <button
                            key={a.id}
                            type="button"
                            onClick={() => openEdit(a)}
                            className={`w-full text-left px-4 py-2 text-sm border-b last:border-b-0 transition-colors ${
                              a.id === editAccount.id
                                ? 'bg-blue-50 border-l-2 border-l-blue-400 font-medium text-foreground dark:bg-blue-950/40'
                                : 'hover:bg-muted/50 text-foreground'
                            }`}
                          >
                            {a.name}
                          </button>
                        ))}
                        {previewAccounts.length === 0 && (
                          <p className="px-4 py-3 text-xs text-muted-foreground">No active accounts in this category.</p>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {editErr && <p className="text-sm text-destructive">{editErr}</p>}
              </div>

              <div className="border-t px-6 py-4 flex items-center justify-between gap-2">
                <Button type="button" variant="outline" onClick={() => setEditAccount(null)}>Cancel</Button>
                <Button type="submit" disabled={editBusy}>
                  {editBusy ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── New account drawer ── */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/20" onClick={() => setShowCreate(false)} />
          <div className="w-[420px] bg-background shadow-xl flex flex-col border-l" role="dialog" aria-modal="true" aria-label="New account">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h2 className="text-lg font-semibold">New account</h2>
              <button type="button" className="text-muted-foreground hover:text-foreground text-lg leading-none" onClick={() => setShowCreate(false)}>✕</button>
            </div>
            <form className="flex flex-col flex-1 overflow-hidden" onSubmit={e => void create(e)}>
              <div className="flex-1 overflow-auto p-6 space-y-4">
                {createParentId && (
                  <div className="rounded-md bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                    Subaccount of: <span className="font-medium text-foreground">{accounts.find(a => a.id === createParentId)?.name ?? ''}</span>
                  </div>
                )}
                <div>
                  <Label>Account name <span className="text-destructive">*</span></Label>
                  <Input className="mt-1" placeholder="e.g. Cash" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required autoFocus />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Account type <span className="text-destructive">*</span></Label>
                    <select
                      className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
                      value={form.account_type}
                      onChange={e => setForm(f => ({ ...f, account_type: e.target.value, detail_type: '' }))}
                    >
                      {ACCOUNT_TYPES.map(t => (
                        <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label>Detail type</Label>
                    <select
                      className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
                      value={form.detail_type}
                      onChange={e => setForm(f => ({ ...f, detail_type: e.target.value }))}
                    >
                      <option value="">— select —</option>
                      {(DETAIL_TYPES[form.account_type] ?? []).map(dt => (
                        <option key={dt} value={dt}>{dt}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <Label>Account code <span className="text-destructive">*</span></Label>
                  <Input className="mt-1" placeholder="e.g. 1000" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} required />
                </div>
                <div>
                  <Label>Description</Label>
                  <textarea
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
                    rows={3}
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="Optional description"
                  />
                </div>
                {createErr && <p className="text-sm text-destructive">{createErr}</p>}
              </div>
              <div className="border-t px-6 py-4 flex items-center justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
                <Button type="submit">Save</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Import modal ── */}
      <Dialog open={showImport} onOpenChange={(open) => { if (!open) { setShowImport(false); setImportRows([]); setImportDone(false); } }}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {importRows.length === 0
                ? 'Import a chart of accounts'
                : importDone
                  ? `Done — ${successImportCount} imported, ${errorImportCount} failed`
                  : `${validImportCount} of ${importRows.length} rows ready to import`}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-auto p-6">
            <input ref={importFileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImportFileChange} />

            {importRows.length === 0 ? (
              <div
                className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center cursor-pointer transition-colors ${dropActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/30 hover:border-primary/50'}`}
                onClick={() => importFileRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDropActive(true); }}
                onDragLeave={() => setDropActive(false)}
                onDrop={e => { e.preventDefault(); setDropActive(false); const file = e.dataTransfer.files[0]; if (file) handleImportFile(file); }}
              >
                <svg className="mb-3 h-10 w-10 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-sm">Drag and drop or <span className="font-medium text-primary underline">select files</span></p>
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
                      {IMPORT_COLS.map(c => <td key={c.key} className="p-2 truncate max-w-[150px]">{row.data[c.key] ?? ''}</td>)}
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

          <DialogFooter className="justify-between gap-3">
            <button type="button" className="text-sm text-primary underline hover:no-underline" onClick={downloadSampleTemplate}>
              Download sample template
            </button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setShowImport(false); setImportRows([]); setImportDone(false); }}>Cancel</Button>
              {importRows.length === 0 && <Button onClick={() => importFileRef.current?.click()}>Next</Button>}
              {importRows.length > 0 && !importDone && (
                <Button onClick={() => void runImport()} disabled={importBusy || validImportCount === 0}>
                  {importBusy ? 'Importing…' : `Import ${validImportCount} record${validImportCount === 1 ? '' : 's'}`}
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
