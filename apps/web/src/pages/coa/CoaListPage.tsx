import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, FileDown, Landmark, Printer, Search, Settings } from 'lucide-react';
import * as XLSX from 'xlsx';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { downloadAsExcel } from '@/lib/download';
import { fmtMoney } from '@/lib/money';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';

const IMPORT_COLS = [
  { key: 'name', header: 'Name', required: true },
  { key: 'code', header: 'Code', required: true },
  { key: 'account_type', header: 'Account Type', required: true },
];

// Accepts common column name variations so uploads don't need to match exactly.
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

interface ImportRow {
  data: Record<string, string>;
  status: 'pending' | 'ok' | 'error';
  error: string | null;
}

type Account = {
  id: string; code: string; name: string; account_type: string;
  is_system: boolean; is_active: boolean; parent_id: string | null;
  detail_type: string | null; description: string | null;
};
type TbRow = { account_id: string; net: string };
type BankAcct = { id: string; cash_account_id: string; bank_balance?: string };

const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;

// QBO-style detail types per account type (free-text on the API; these are the
// standard picks).
const DETAIL_TYPES: Record<string, string[]> = {
  asset: ['Checking', 'Savings', 'Money Market', 'Cash on Hand', 'Accounts Receivable', 'Prepaid Expenses', 'Inventory', 'Fixed Assets', 'Buildings', 'Vehicles', 'Equipment', 'Accumulated Depreciation', 'Other Assets'],
  liability: ['Accounts Payable', 'Credit Card', 'Line of Credit', 'Loan Payable', 'Sales Tax Payable', 'Accrued Liabilities', 'Customer Deposits', 'Notes Payable', 'Mortgage', 'Other Liabilities'],
  equity: ['Opening Balance Equity', 'Retained Earnings', 'Common Stock', 'Partner Contributions', 'Partner Distributions', 'Paid-In Capital', 'Other Equity'],
  revenue: ['Sales Income', 'Service Income', 'Interest Earned', 'Dividend Income', 'Other Income', 'Discounts Given'],
  expense: ['Advertising', 'Auto', 'Bank Charges', 'Cost of Labor', 'Dues & Subscriptions', 'Equipment Rental', 'Insurance', 'Legal & Professional Fees', 'Meals & Entertainment', 'Office Expenses', 'Payroll Expenses', 'Rent', 'Repairs & Maintenance', 'Taxes & Licenses', 'Travel', 'Utilities', 'Other Expenses'],
};

// QBO shows balances in the account's natural sign: debit-normal for
// asset/expense, credit-normal for liability/equity/revenue. TB nets are
// debit-minus-credit, so credit-normal accounts flip sign for display.
function naturalNet(accountType: string, net: string): number {
  const n = Number(net);
  return accountType === 'asset' || accountType === 'expense' ? n : -n;
}

function inactivePill() {
  return <span className="ml-2 inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">Inactive</span>;
}

function statusBadge(active: boolean) {
  const base = 'inline-flex rounded-full px-2 py-0.5 text-xs font-medium';
  return active
    ? <span className={`${base} bg-emerald-100 text-emerald-800`}>Active</span>
    : <span className={`${base} bg-muted text-muted-foreground`}>Inactive</span>;
}

type ColumnPrefs = { showType: boolean; showDetailType: boolean; showDescription: boolean; showBalance: boolean; showBankBalance: boolean; showStatus: boolean; pageSize: number };
const PREFS_KEY = 'coa.list.prefs';
const DEFAULT_PREFS: ColumnPrefs = { showType: true, showDetailType: true, showDescription: false, showBalance: true, showBankBalance: true, showStatus: true, pageSize: 75 };

function loadPrefs(): ColumnPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<ColumnPrefs>) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export default function CoaListPage() {
  const [bizId] = useActiveBusinessId();
  const navigate = useNavigate();
  const location = useLocation();
  const [accounts, setAccounts] = useState<Account[]>([]);
  // null = source unavailable (older API deploy / fetch error) → show em-dash.
  const [tbMap, setTbMap] = useState<Map<string, string> | null>(null);
  const [bankMap, setBankMap] = useState<Map<string, string | null>>(new Map());
  const [showCreate, setShowCreate] = useState(false);
  const [createParentId, setCreateParentId] = useState<string | null>(null);
  const [form, setForm] = useState({ code: '', name: '', account_type: 'asset', detail_type: '', description: '' });
  const [err, setErr] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [excelBusy, setExcelBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState('active');
  const [search, setSearch] = useState('');

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [showBatchMenu, setShowBatchMenu] = useState(false);
  const [showGearMenu, setShowGearMenu] = useState(false);
  const [rowMenuId, setRowMenuId] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<ColumnPrefs>(loadPrefs);

  const [editAcct, setEditAcct] = useState<Account | null>(null);
  const [editForm, setEditForm] = useState({ code: '', name: '', parent_id: '', is_active: true, detail_type: '', description: '' });
  const [editBalance, setEditBalance] = useState<string | null>(null);
  const [editErr, setEditErr] = useState<string | null>(null);

  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [showImport, setShowImport] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importBusy, setImportBusy] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const [importParseErr, setImportParseErr] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);

  // Register lives under whichever section the user is browsing.
  const registerBase = location.pathname.startsWith('/settings') ? '/settings/coa' : '/setup/coa';

  function savePrefs(next: ColumnPrefs) {
    setPrefs(next);
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  }

  async function reload() {
    if (!bizId) return;
    const r = await api.get(`/businesses/${bizId}/coa?include_inactive=true`);
    setAccounts(r.data.accounts);
    // Balance + bank-link sources load independently; the list must still
    // render if either endpoint is unavailable.
    try {
      const tb = await api.get(`/businesses/${bizId}/reports/trial-balance`);
      setTbMap(new Map((tb.data.rows as TbRow[]).map(row => [row.account_id, row.net])));
    } catch {
      setTbMap(null);
    }
    try {
      const ba = await api.get(`/businesses/${bizId}/bank-accounts`);
      const m = new Map<string, string | null>();
      for (const b of ba.data.bank_accounts as BankAcct[]) {
        const prev = m.get(b.cash_account_id);
        if (b.bank_balance === undefined) { m.set(b.cash_account_id, prev ?? null); continue; }
        const sum = Number(prev ?? '0') + Number(b.bank_balance);
        m.set(b.cash_account_id, String(sum));
      }
      setBankMap(m);
    } catch {
      setBankMap(new Map());
    }
  }
  useEffect(() => { void reload(); }, [bizId]);

  // Escape closes the drawers (parity with the Dialog-based modals).
  useEffect(() => {
    if (!showCreate && !editAcct) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setShowCreate(false); setEditAcct(null); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showCreate, editAcct]);

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
      await api.post(`/businesses/${bizId}/coa`, {
        code: form.code,
        name: form.name,
        account_type: form.account_type,
        parent_id: createParentId,
        detail_type: form.detail_type || null,
        description: form.description || null,
      });
      setForm({ code: '', name: '', account_type: 'asset', detail_type: '', description: '' });
      setCreateParentId(null);
      setShowCreate(false);
      await reload();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed');
    }
  }

  function openEdit(a: Account) {
    setEditErr(null);
    setEditForm({
      code: a.code, name: a.name, parent_id: a.parent_id ?? '', is_active: a.is_active,
      detail_type: a.detail_type ?? '', description: a.description ?? '',
    });
    setEditAcct(a);
    setRowMenuId(null);
    // Current balance shown in the drawer header; tolerate older API deploys.
    setEditBalance(null);
    api.get(`/businesses/${bizId}/coa/${a.id}`)
      .then(r => setEditBalance(String(r.data.balance ?? '0')))
      .catch(() => setEditBalance(null));
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editAcct) return;
    setEditErr(null);
    try {
      await api.patch(`/businesses/${bizId}/coa/${editAcct.id}`, {
        code: editForm.code,
        name: editForm.name,
        parent_id: editForm.parent_id || null,
        is_active: editForm.is_active,
        detail_type: editForm.detail_type || null,
        description: editForm.description || null,
      });
      setEditAcct(null);
      await reload();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setEditErr(msg ?? 'Failed');
    }
  }

  async function setActive(ids: string[], active: boolean) {
    setBatchBusy(true);
    try {
      for (const id of ids) {
        // eslint-disable-next-line no-await-in-loop
        await api.patch(`/businesses/${bizId}/coa/${id}`, { is_active: active });
      }
      setSelectedIds(new Set());
      await reload();
    } finally {
      setBatchBusy(false);
      setShowBatchMenu(false);
      setRowMenuId(null);
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

  // Selections don't survive filter changes — acting on hidden rows surprises.
  useEffect(() => { setSelectedIds(new Set()); }, [typeFilter, statusFilter, search]);

  // Sub-account hierarchy: depth for name indenting, descendants to keep the
  // parent picker acyclic. Cycle-guarded (the API only blocks self-reference).
  const { depthById, childrenById } = useMemo(() => {
    const byId = new Map(accounts.map(a => [a.id, a]));
    const children = new Map<string, string[]>();
    for (const a of accounts) {
      if (!a.parent_id) continue;
      children.set(a.parent_id, [...(children.get(a.parent_id) ?? []), a.id]);
    }
    const depth = new Map<string, number>();
    for (const a of accounts) {
      let d = 0;
      const seen = new Set<string>([a.id]);
      let cur = a.parent_id;
      while (cur && byId.has(cur) && !seen.has(cur) && d < 6) { seen.add(cur); d++; cur = byId.get(cur)!.parent_id; }
      depth.set(a.id, d);
    }
    return { depthById: depth, childrenById: children };
  }, [accounts]);

  function descendantsOf(id: string): Set<string> {
    const out = new Set<string>();
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const c of childrenById.get(cur) ?? []) {
        if (!out.has(c)) { out.add(c); stack.push(c); }
      }
    }
    return out;
  }

  function displayBalance(a: Account): string | null {
    if (!tbMap) return null;
    const net = tbMap.get(a.id);
    if (net === undefined) return fmtMoney(0);
    return fmtMoney(naturalNet(a.account_type, net));
  }

  function displayBankBalance(a: Account): string | null {
    if (!bankMap.has(a.id)) return null; // not a bank-linked account → blank cell
    const v = bankMap.get(a.id);
    return v === null || v === undefined ? '—' : fmtMoney(v);
  }

  function handleExport() {
    setExcelBusy(true);
    try {
      const headers = ['Number', 'Name', 'Type', 'Balance', 'Status', 'System'];
      const rows = filtered.map(a => [a.code, a.name, a.account_type, displayBalance(a) ?? '', a.is_active ? 'active' : 'inactive', a.is_system ? 'yes' : 'no']);
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
        <td style="text-align:right">${displayBalance(a) ?? ''}</td>
        <td style="text-transform:capitalize">${a.is_active ? 'active' : 'inactive'}</td>
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
        th.num, td.num { text-align: right; }
        td { padding: 5px 8px; border-bottom: 1px solid #e5e5e5; }
        tr:last-child td { border-bottom: none; }
      </style></head><body>
      <h2>Chart of Accounts</h2>
      <p>Generated ${new Date().toLocaleDateString()}</p>
      <table>
        <thead><tr><th>Number</th><th>Name</th><th>Type</th><th class="num">Balance</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <script>window.onload = function(){ window.print(); }${'</'}script>
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
    { key: 'code', header: 'Number', sortable: true, sortValue: r => r.code, render: r => <span className="font-mono text-muted-foreground">{r.code}</span> },
    {
      key: 'name', header: 'Name', sortable: true, sortValue: r => r.name,
      render: r => (
        <span className="font-medium" style={{ paddingLeft: `${(depthById.get(r.id) ?? 0) * 16}px` }}>
          {r.name}
          {/* The inline pill only carries status when the Status column is hidden. */}
          {!r.is_active && !prefs.showStatus && inactivePill()}
        </span>
      ),
    },
    ...(prefs.showType ? [{
      key: 'account_type', header: 'Account type', sortable: true, sortValue: (r: Account) => r.account_type,
      render: (r: Account) => (
        <span className="inline-flex items-center gap-1.5 capitalize">
          {bankMap.has(r.id) && <Landmark className="h-3.5 w-3.5 text-muted-foreground" aria-label="Linked bank account" />}
          {r.account_type}
        </span>
      ),
    }] : []),
    ...(prefs.showDetailType ? [{
      key: 'detail_type', header: 'Detail type', sortable: true,
      sortValue: (r: Account) => r.detail_type ?? '',
      exportValue: (r: Account) => r.detail_type ?? '',
      render: (r: Account) => <span className="text-muted-foreground">{r.detail_type ?? ''}</span>,
    }] : []),
    ...(prefs.showDescription ? [{
      key: 'description', header: 'Description', sortable: false,
      exportValue: (r: Account) => r.description ?? '',
      render: (r: Account) => <span className="block max-w-[16rem] truncate text-muted-foreground" title={r.description ?? undefined}>{r.description ?? ''}</span>,
    }] : []),
    ...(prefs.showBalance ? [{
      key: 'balance', header: 'Balance', align: 'right' as const, sortable: true,
      sortValue: (r: Account) => (tbMap ? naturalNet(r.account_type, tbMap.get(r.id) ?? '0') : 0),
      exportValue: (r: Account) => displayBalance(r) ?? '',
      render: (r: Account) => <span className="tabular-nums">{displayBalance(r) ?? '—'}</span>,
    }] : []),
    ...(prefs.showBankBalance ? [{
      key: 'bank_balance', header: 'Bank balance', align: 'right' as const, sortable: true,
      sortValue: (r: Account) => Number(bankMap.get(r.id) ?? Number.NEGATIVE_INFINITY),
      exportValue: (r: Account) => displayBankBalance(r) ?? '',
      render: (r: Account) => <span className="tabular-nums">{displayBankBalance(r) ?? ''}</span>,
    }] : []),
    ...(prefs.showStatus ? [{
      key: 'status', header: 'Status', sortable: true,
      sortValue: (r: Account) => (r.is_active ? 'active' : 'inactive'),
      exportValue: (r: Account) => (r.is_active ? 'active' : 'inactive'),
      render: (r: Account) => statusBadge(r.is_active),
    }] : []),
  ];

  function rowActions(r: Account) {
    return (
      <div className="inline-flex items-center">
        <button
          type="button"
          className="text-sm font-medium text-primary hover:underline"
          onClick={() => navigate(`${registerBase}/${r.id}/register`)}
        >
          View register
        </button>
        <div className="relative">
          <button
            type="button"
            className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded text-primary hover:bg-accent"
            aria-label="More actions"
            onClick={() => setRowMenuId(id => (id === r.id ? null : r.id))}
          >
            <ChevronDown className="h-4 w-4" />
          </button>
          {rowMenuId === r.id && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setRowMenuId(null)} />
              <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-md border bg-background py-1 text-left shadow-lg">
                <button
                  className="w-full px-4 py-2 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={r.is_system}
                  title={r.is_system ? 'System accounts cannot be renamed or renumbered' : undefined}
                  onClick={() => openEdit(r)}
                >
                  Edit
                </button>
                <button
                  className="w-full px-4 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => {
                    setRowMenuId(null);
                    setErr(null);
                    setCreateParentId(r.id);
                    setForm({ code: '', name: '', account_type: r.account_type, detail_type: '', description: '' });
                    setShowCreate(true);
                  }}
                >
                  Create sub-account
                </button>
                <button
                  className="w-full px-4 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => void setActive([r.id], !r.is_active)}
                >
                  {r.is_active ? 'Make inactive' : 'Make active'}
                </button>
                <button
                  className="w-full px-4 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => { setRowMenuId(null); navigate(`${registerBase}/${r.id}/register`); }}
                >
                  Run report
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  const validImportCount = importRows.filter(r => !r.error).length;
  const successImportCount = importRows.filter(r => r.status === 'ok').length;
  const errorImportCount = importRows.filter(r => r.status === 'error').length;

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <div className="space-y-4">

      {/* Header: title + split New account button */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Chart of Accounts</h1>
        <div className="flex items-center" ref={dropdownRef}>
          <Button
            className="rounded-r-none border-r border-primary-foreground/20"
            onClick={() => {
              setErr(null);
              setCreateParentId(null);
              setForm({ code: '', name: '', account_type: 'asset', detail_type: '', description: '' });
              setShowCreate(true);
            }}
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

      {/* QBO-style toolbar: batch actions + filters left, tools right */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Button
            variant="outline"
            className="h-9 gap-1 font-medium"
            disabled={selectedIds.size === 0 || batchBusy}
            onClick={() => setShowBatchMenu(m => !m)}
          >
            {batchBusy ? 'Working…' : 'Batch actions'} <ChevronDown className="h-4 w-4" />
          </Button>
          {showBatchMenu && selectedIds.size > 0 && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowBatchMenu(false)} />
              <div className="absolute left-0 top-full z-50 mt-1 w-48 rounded-md border bg-background py-1 shadow-lg">
                <button className="w-full px-4 py-2 text-left text-sm hover:bg-accent" onClick={() => void setActive([...selectedIds], false)}>
                  Make inactive ({selectedIds.size})
                </button>
                <button className="w-full px-4 py-2 text-left text-sm hover:bg-accent" onClick={() => void setActive([...selectedIds], true)}>
                  Make active ({selectedIds.size})
                </button>
              </div>
            </>
          )}
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8 w-64 h-9"
            placeholder="Filter by name or number"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          className="h-9 rounded-md border bg-background px-3 text-sm capitalize"
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          aria-label="Account type"
        >
          <option value="">All</option>
          {ACCOUNT_TYPES.map(t => <option key={t} value={t} className="capitalize">{t}</option>)}
        </select>
        <select
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          aria-label="Status"
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All statuses</option>
        </select>

        <div className="ml-auto flex items-center gap-2">
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
          <div className="relative">
            <button
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              onClick={() => setShowGearMenu(m => !m)}
              aria-label="Table settings"
            >
              <Settings className="h-4 w-4" />
            </button>
            {showGearMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowGearMenu(false)} />
                <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-md border bg-background p-3 shadow-lg space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Columns</div>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={prefs.showType} onChange={e => savePrefs({ ...prefs, showType: e.target.checked })} />
                    Account type
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={prefs.showDetailType} onChange={e => savePrefs({ ...prefs, showDetailType: e.target.checked })} />
                    Detail type
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={prefs.showDescription} onChange={e => savePrefs({ ...prefs, showDescription: e.target.checked })} />
                    Description
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={prefs.showBalance} onChange={e => savePrefs({ ...prefs, showBalance: e.target.checked })} />
                    Balance
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={prefs.showBankBalance} onChange={e => savePrefs({ ...prefs, showBankBalance: e.target.checked })} />
                    Bank balance
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={prefs.showStatus} onChange={e => savePrefs({ ...prefs, showStatus: e.target.checked })} />
                    Status
                  </label>
                  <div className="border-t pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Rows per page</div>
                  <select
                    className="h-8 w-full rounded-md border bg-background px-2 text-sm"
                    value={prefs.pageSize}
                    onChange={e => savePrefs({ ...prefs, pageSize: Number(e.target.value) })}
                  >
                    {[75, 150, 300].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <Card><CardContent className="p-0">
        <DataTable
          rows={filtered}
          getRowId={r => r.id}
          columns={columns}
          defaultSortKey="code"
          defaultSortDir="asc"
          selectedIds={selectedIds}
          onSelectedIdsChange={setSelectedIds}
          actions={rowActions}
          actionsHeader="Action"
          pagination={{ pageSize: prefs.pageSize }}
          emptyMessage={<EmptyState title="No accounts found" hint="Adjust the filters above, import accounts, or add a new account to your chart." />}
        />
      </CardContent></Card>

      {/* New account — right-side drawer */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/20" onClick={() => setShowCreate(false)} />
          <div className="w-96 bg-background shadow-xl flex flex-col border-l" role="dialog" aria-modal="true" aria-label="New account">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold">{createParentId ? 'New sub-account' : 'New account'}</h2>
                {createParentId && (
                  <p className="text-xs text-muted-foreground">
                    Under {accounts.find(a => a.id === createParentId)?.name ?? ''}
                  </p>
                )}
              </div>
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
                    className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm disabled:opacity-60"
                    value={form.account_type}
                    // Sub-accounts inherit the parent's type.
                    disabled={createParentId !== null}
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
                    <option value="">Select detail type…</option>
                    {(DETAIL_TYPES[form.account_type] ?? []).map(dt => (
                      <option key={dt} value={dt}>{dt}</option>
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
                <div>
                  <Label>Description</Label>
                  <textarea
                    className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                    rows={3}
                    placeholder="What is this account used for?"
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
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

      {/* Edit account — right-side drawer (name + number; type is immutable) */}
      {editAcct && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/20" onClick={() => setEditAcct(null)} />
          <div className="w-96 bg-background shadow-xl flex flex-col border-l" role="dialog" aria-modal="true" aria-label="Edit account">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold">Edit account</h2>
                {editBalance !== null && (
                  <p className="text-xs text-muted-foreground">
                    Current balance <span className="font-mono font-medium text-foreground">{fmtMoney(editBalance)}</span>
                  </p>
                )}
              </div>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground text-lg"
                onClick={() => setEditAcct(null)}
              >
                ✕
              </button>
            </div>
            <form className="flex flex-col flex-1 overflow-hidden" onSubmit={saveEdit}>
              <div className="flex-1 overflow-auto p-6 space-y-4">
                <div>
                  <Label>Account name <span className="text-destructive">*</span></Label>
                  <Input
                    className="mt-1"
                    value={editForm.name}
                    onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                    required
                    autoFocus
                  />
                </div>
                <div>
                  <Label>Account number <span className="text-destructive">*</span></Label>
                  <Input
                    className="mt-1"
                    value={editForm.code}
                    onChange={e => setEditForm(f => ({ ...f, code: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <Label>Account type</Label>
                  <div className="mt-1 h-10 flex items-center rounded-md border bg-muted/40 px-3 text-sm capitalize text-muted-foreground">
                    {editAcct.account_type}
                  </div>
                </div>
                <div>
                  <Label>Detail type</Label>
                  <select
                    className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={editForm.detail_type}
                    onChange={e => setEditForm(f => ({ ...f, detail_type: e.target.value }))}
                  >
                    <option value="">Select detail type…</option>
                    {(DETAIL_TYPES[editAcct.account_type] ?? []).map(dt => (
                      <option key={dt} value={dt}>{dt}</option>
                    ))}
                    {/* Preserve a non-standard stored value instead of silently dropping it. */}
                    {editForm.detail_type && !(DETAIL_TYPES[editAcct.account_type] ?? []).includes(editForm.detail_type) && (
                      <option value={editForm.detail_type}>{editForm.detail_type}</option>
                    )}
                  </select>
                </div>
                <div>
                  <Label>Description</Label>
                  <textarea
                    className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                    rows={3}
                    placeholder="What is this account used for?"
                    value={editForm.description}
                    onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>Sub-account of</Label>
                  <select
                    className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={editForm.parent_id}
                    onChange={e => setEditForm(f => ({ ...f, parent_id: e.target.value }))}
                  >
                    <option value="">None (top-level account)</option>
                    {(() => {
                      // Same type only; never self or a descendant (would cycle).
                      const blocked = descendantsOf(editAcct.id);
                      return accounts
                        .filter(a => a.account_type === editAcct.account_type && a.id !== editAcct.id && !blocked.has(a.id))
                        .map(a => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>);
                    })()}
                  </select>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editForm.is_active}
                    onChange={e => setEditForm(f => ({ ...f, is_active: e.target.checked }))}
                  />
                  Active
                </label>
                {editErr && <p className="text-sm text-destructive">{editErr}</p>}
              </div>
              <div className="border-t px-6 py-4 flex items-center justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setEditAcct(null)}>Cancel</Button>
                <Button type="submit">Save</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import chart of accounts modal */}
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

          <DialogFooter className="justify-between gap-3">
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
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
