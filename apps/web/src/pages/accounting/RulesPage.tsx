import { useEffect, useMemo, useState } from 'react';
import { FileDown, GripVertical, Printer } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmtMoney } from '@/lib/money';
import { downloadAsExcel } from '@/lib/download';
import { EmptyState } from '@/components/ui/EmptyState';

type SignFilter = 'any' | 'inflow_only' | 'outflow_only';

type Rule = {
  id: string;
  business_id: string;
  name: string;
  description_contains: string;
  min_amount: string | null;
  max_amount: string | null;
  sign_filter: SignFilter;
  offset_account_id: string;
  offset_account_code: string;
  offset_account_name: string;
  bank_account_id: string | null;
  bank_account_name: string | null;
  priority: number;
  is_active: boolean;
};

type BankAccount = {
  id: string;
  name: string;
  institution: string | null;
  account_last_four: string | null;
  cash_account_id: string;
  is_active: boolean;
};

type Account = {
  id: string;
  code: string;
  name: string;
  account_type: string;
  is_system: boolean;
  is_active: boolean;
};

type BankTransaction = {
  id: string;
  status: 'unreviewed' | 'matched' | 'categorized' | 'excluded';
};

type RuleFormState = {
  name: string;
  description_contains: string;
  min_amount: string;
  max_amount: string;
  sign_filter: SignFilter;
  offset_account_id: string;
  bank_account_id: string;
  priority: string;
  is_active: boolean;
};

type ApplyResult = {
  applied: number;
  rules_tried: number;
  unreviewed_before: number;
};

const EMPTY_FORM: RuleFormState = {
  name: '',
  description_contains: '',
  min_amount: '',
  max_amount: '',
  sign_filter: 'outflow_only',
  offset_account_id: '',
  bank_account_id: '',
  priority: '100',
  is_active: true,
};

const DIRECTION_OPTIONS: Array<{ value: SignFilter; label: string }> = [
  { value: 'outflow_only', label: 'Money out' },
  { value: 'inflow_only', label: 'Money in' },
  { value: 'any', label: 'Money out or in' },
];

const SIGN_FILTER_LABELS: Record<SignFilter, string> = {
  any: 'Any',
  inflow_only: 'Inflow only',
  outflow_only: 'Outflow only',
};


function directionLabel(s: SignFilter): string {
  return DIRECTION_OPTIONS.find(o => o.value === s)?.label ?? s;
}

function pickErr(e: unknown): string {
  return (e as { response?: { data?: { error?: { message?: string } } } } | undefined)
    ?.response?.data?.error?.message ?? 'Failed';
}

function amountRangeLabel(min: string | null, max: string | null): string {
  if (min == null && max == null) return '';
  if (min != null && max != null) return `${fmtMoney(min)}–${fmtMoney(max)}`;
  if (min != null) return `≥ ${fmtMoney(min)}`;
  if (max != null) return `≤ ${fmtMoney(max)}`;
  return '';
}

function ruleToForm(r: Rule): RuleFormState {
  return {
    name: r.name,
    description_contains: r.description_contains,
    min_amount: r.min_amount ?? '',
    max_amount: r.max_amount ?? '',
    sign_filter: r.sign_filter,
    offset_account_id: r.offset_account_id,
    bank_account_id: r.bank_account_id ?? '',
    priority: String(r.priority),
    is_active: r.is_active,
  };
}

type CreateBody = {
  name: string;
  description_contains: string;
  offset_account_id: string;
  sign_filter: SignFilter;
  priority: number;
  min_amount?: string;
  max_amount?: string;
  bank_account_id?: string;
};

type PatchBody = Partial<{
  name: string;
  description_contains: string;
  offset_account_id: string;
  sign_filter: SignFilter;
  priority: number;
  is_active: boolean;
  min_amount: string | null;
  max_amount: string | null;
  bank_account_id: string | null;
}>;

function formToCreateBody(form: RuleFormState): CreateBody {
  const priorityNum = Number.parseInt(form.priority, 10);
  const body: CreateBody = {
    name: form.name.trim(),
    description_contains: form.description_contains.trim(),
    offset_account_id: form.offset_account_id,
    sign_filter: form.sign_filter,
    priority: Number.isFinite(priorityNum) ? priorityNum : 100,
  };
  if (form.min_amount.trim() !== '') body.min_amount = form.min_amount.trim();
  if (form.max_amount.trim() !== '') body.max_amount = form.max_amount.trim();
  if (form.bank_account_id !== '') body.bank_account_id = form.bank_account_id;
  return body;
}

function formToPatchBody(form: RuleFormState): PatchBody {
  const priorityNum = Number.parseInt(form.priority, 10);
  return {
    name: form.name.trim(),
    description_contains: form.description_contains.trim(),
    offset_account_id: form.offset_account_id,
    sign_filter: form.sign_filter,
    priority: Number.isFinite(priorityNum) ? priorityNum : 100,
    is_active: form.is_active,
    min_amount: form.min_amount.trim() === '' ? null : form.min_amount.trim(),
    max_amount: form.max_amount.trim() === '' ? null : form.max_amount.trim(),
    bank_account_id: form.bank_account_id === '' ? null : form.bank_account_id,
  };
}

export default function RulesPage() {
  const [bizId] = useActiveBusinessId();
  const [rules, setRules] = useState<Rule[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);

  const [applyBankAccountId, setApplyBankAccountId] = useState<string>('');
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [applyBusy, setApplyBusy] = useState(false);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<'create' | 'edit'>('create');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<RuleFormState>(EMPTY_FORM);
  const [formBusy, setFormBusy] = useState(false);

  const [rowBusyId, setRowBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'disabled' | 'invalid'>('all');
  const [excelBusy, setExcelBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  async function reload() {
    if (!bizId) return;
    const r = await api.get(`/businesses/${bizId}/bank-rules`);
    const list = r.data.bank_rules as Rule[];
    setRules(list.slice().sort((a, b) => a.priority - b.priority));
  }

  useEffect(() => {
    if (!bizId) return;
    (async () => {
      try {
        const [ba, coa] = await Promise.all([
          api.get(`/businesses/${bizId}/bank-accounts`),
          api.get(`/businesses/${bizId}/coa`),
        ]);
        const baList: BankAccount[] = ba.data.bank_accounts;
        setBankAccounts(baList);
        setAccounts(coa.data.accounts);
        if (baList.length > 0 && !applyBankAccountId) {
          const first = baList[0];
          if (first) setApplyBankAccountId(first.id);
        }
        await reload();
      } catch (e: unknown) {
        setErr(pickErr(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bizId]);

  const groupedAccounts = useMemo(() => {
    const groups: Record<string, Account[]> = {};
    for (const a of accounts) {
      if (!a.is_active) continue;
      const key = a.account_type;
      const bucket = groups[key] ?? [];
      bucket.push(a);
      groups[key] = bucket;
    }
    for (const k of Object.keys(groups)) {
      groups[k] = (groups[k] ?? []).slice().sort((x, y) => x.code.localeCompare(y.code));
    }
    return groups;
  }, [accounts]);

  const filteredRules = useMemo(() => {
    return rules.filter(r => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        if (!r.name.toLowerCase().includes(q) && !r.description_contains.toLowerCase().includes(q)) return false;
      }
      if (statusFilter === 'active') return r.is_active;
      if (statusFilter === 'disabled') return !r.is_active;
      if (statusFilter === 'invalid') return !r.offset_account_id;
      return true;
    });
  }, [rules, searchQuery, statusFilter]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setDrawerMode('create');
    setErr(null);
    setDrawerOpen(true);
  }

  function openEdit(r: Rule) {
    setForm(ruleToForm(r));
    setEditingId(r.id);
    setDrawerMode('edit');
    setErr(null);
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setEditingId(null);
    setErr(null);
  }

  async function applyRules(e: React.FormEvent) {
    e.preventDefault();
    if (!bizId || !applyBankAccountId) return;
    setApplyBusy(true); setErr(null); setApplyResult(null);
    try {
      const before = await api.get(`/businesses/${bizId}/bank-transactions`, {
        params: { bank_account_id: applyBankAccountId, status: 'unreviewed' },
      });
      const unreviewedBefore: number = (before.data.bank_transactions as BankTransaction[]).length;
      const r = await api.post(`/businesses/${bizId}/bank-rules/apply`, {
        bank_account_id: applyBankAccountId,
      });
      setApplyResult({ applied: r.data.applied, rules_tried: r.data.rules_tried, unreviewed_before: unreviewedBefore });
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setApplyBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!bizId) return;
    setFormBusy(true); setErr(null);
    try {
      if (drawerMode === 'create') {
        await api.post(`/businesses/${bizId}/bank-rules`, formToCreateBody(form));
      } else {
        await api.patch(`/businesses/${bizId}/bank-rules/${editingId}`, formToPatchBody(form));
      }
      closeDrawer();
      await reload();
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setFormBusy(false);
    }
  }

  async function toggleActive(r: Rule) {
    if (!bizId) return;
    setRowBusyId(r.id); setErr(null);
    try {
      await api.patch(`/businesses/${bizId}/bank-rules/${r.id}`, { is_active: !r.is_active });
      await reload();
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setRowBusyId(null);
    }
  }

  async function remove(r: Rule) {
    if (!bizId) return;
    if (!window.confirm(`Delete rule "${r.name}"?`)) return;
    setRowBusyId(r.id); setErr(null);
    try {
      await api.delete(`/businesses/${bizId}/bank-rules/${r.id}`);
      await reload();
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setRowBusyId(null);
    }
  }

  const allSelected = filteredRules.length > 0 && filteredRules.every(r => selectedIds.has(r.id));
  const someSelected = !allSelected && filteredRules.some(r => selectedIds.has(r.id));

  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(filteredRules.map(r => r.id)));
  }
  function toggleRow(id: string) {
    setSelectedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  async function bulkSetActive(active: boolean) {
    if (!bizId) return;
    setBulkBusy(true); setErr(null);
    try {
      await Promise.all([...selectedIds].map(id => api.patch(`/businesses/${bizId}/bank-rules/${id}`, { is_active: active })));
      setSelectedIds(new Set());
      await reload();
    } catch (e: unknown) { setErr(pickErr(e)); }
    finally { setBulkBusy(false); }
  }

  async function bulkDelete() {
    if (!bizId || !window.confirm(`Delete ${selectedIds.size} rule(s)?`)) return;
    setBulkBusy(true); setErr(null);
    try {
      await Promise.all([...selectedIds].map(id => api.delete(`/businesses/${bizId}/bank-rules/${id}`)));
      setSelectedIds(new Set());
      await reload();
    } catch (e: unknown) { setErr(pickErr(e)); }
    finally { setBulkBusy(false); }
  }

  async function handleDrop(targetIdx: number) {
    if (dragIndex === null || dragIndex === targetIdx) {
      setDragIndex(null); setOverIndex(null); return;
    }
    const reordered = [...filteredRules];
    const moved = reordered.splice(dragIndex, 1)[0];
    if (!moved) { setDragIndex(null); setOverIndex(null); return; }
    reordered.splice(targetIdx, 0, moved);
    const newPriorities = new Map(reordered.map((r, i) => [r.id, (i + 1) * 10]));
    setRules(prev =>
      prev.map(r => { const p = newPriorities.get(r.id); return p !== undefined ? { ...r, priority: p } : r; })
         .sort((a, b) => a.priority - b.priority)
    );
    setDragIndex(null); setOverIndex(null);
    if (!bizId) return;
    try {
      await Promise.all([...newPriorities.entries()].map(([id, priority]) =>
        api.patch(`/businesses/${bizId}/bank-rules/${id}`, { priority })
      ));
    } catch (e: unknown) { setErr(pickErr(e)); await reload(); }
  }

  function handleExport() {
    setExcelBusy(true);
    try {
      const headers = ['Name', 'Direction', 'Conditions', 'Amount Range', 'Category', 'Priority', 'Active'];
      const rows = filteredRules.map(r => [
        r.name,
        directionLabel(r.sign_filter),
        `Description contains "${r.description_contains}"`,
        amountRangeLabel(r.min_amount, r.max_amount) || 'Any',
        `${r.offset_account_code} — ${r.offset_account_name}`,
        String(r.priority),
        r.is_active ? 'Yes' : 'No',
      ]);
      downloadAsExcel(headers, rows, 'bank-rules');
    } finally {
      setExcelBusy(false);
    }
  }

  function handlePrint() {
    const rows = filteredRules.map(r => `
      <tr>
        <td>${r.name}</td>
        <td>${directionLabel(r.sign_filter)}</td>
        <td>Description contains "${r.description_contains}"</td>
        <td>${amountRangeLabel(r.min_amount, r.max_amount) || 'Any'}</td>
        <td>${r.offset_account_code} — ${r.offset_account_name}</td>
        <td style="text-align:right">${r.priority}</td>
        <td>${r.is_active ? 'Yes' : 'No'}</td>
      </tr>`).join('');
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>Bank Rules</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 11px; margin: 24px; }
        h2 { margin-bottom: 4px; } p { color:#666; font-size:10px; margin-bottom:16px; }
        table { width:100%; border-collapse:collapse; }
        th { background:#f0f0f0; text-align:left; padding:5px 7px; border-bottom:2px solid #ccc; font-size:10px; text-transform:uppercase; }
        td { padding:4px 7px; border-bottom:1px solid #e5e5e5; }
        tr:last-child td { border-bottom:none; }
      </style></head><body>
      <h2>Bank Rules</h2>
      <p>Generated ${new Date().toLocaleDateString()}</p>
      <table>
        <thead><tr><th>Name</th><th>Direction</th><th>Conditions</th><th>Amount Range</th><th>Category</th><th>Priority</th><th>Active</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <script>window.onload = function(){ window.print(); }<\/script>
    </body></html>`);
    win.document.close();
  }

  const formValid = form.name.trim() !== '' && form.description_contains.trim() !== '' && form.offset_account_id !== '';

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Rules</h1>
        <Button onClick={openCreate}>New rule</Button>
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}

      {/* Rules table */}
      <Card>
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <Input
              placeholder="Search by Name and Conditions"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-72 h-9"
            />
            <select
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
            >
              <option value="all">All rules</option>
              <option value="active">Active rules</option>
              <option value="disabled">Disabled rules</option>
              <option value="invalid">Invalid rules</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative group">
              <button
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                onClick={handleExport}
                disabled={excelBusy}
                aria-label="Export to Excel"
              >
                <FileDown className="h-4 w-4" />
              </button>
              <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                Export to Excel
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
          </div>
        </div>
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 bg-gray-900 text-white px-4 py-3">
            <span className="text-sm font-medium">{selectedIds.size} rule{selectedIds.size !== 1 ? 's' : ''} selected</span>
            <button
              onClick={() => bulkDelete()}
              disabled={bulkBusy}
              className="border border-white/40 px-3 py-1 rounded text-sm hover:bg-white/10 disabled:opacity-50"
            >Delete</button>
            <button
              onClick={() => bulkSetActive(false)}
              disabled={bulkBusy}
              className="border border-white/40 px-3 py-1 rounded text-sm hover:bg-white/10 disabled:opacity-50"
            >Disable</button>
            <button
              onClick={() => bulkSetActive(true)}
              disabled={bulkBusy}
              className="border border-white/40 px-3 py-1 rounded text-sm hover:bg-white/10 disabled:opacity-50"
            >Enable</button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="ml-auto text-white/60 hover:text-white text-lg leading-none"
              aria-label="Clear selection"
            >✕</button>
          </div>
        )}
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="w-8 p-3" />
                <th className="w-10 p-3">
                  <input
                    type="checkbox"
                    className="rounded"
                    checked={allSelected}
                    ref={el => { if (el) el.indeterminate = someSelected; }}
                    onChange={toggleAll}
                  />
                </th>
                <th className="text-left p-3 font-medium text-xs uppercase tracking-wide">Priority</th>
                <th className="text-left p-3 font-medium text-xs uppercase tracking-wide">Rule Name</th>
                <th className="text-left p-3 font-medium text-xs uppercase tracking-wide">Applied To</th>
                <th className="text-left p-3 font-medium text-xs uppercase tracking-wide">Conditions</th>
                <th className="text-left p-3 font-medium text-xs uppercase tracking-wide">Settings</th>
                <th className="text-left p-3 font-medium text-xs uppercase tracking-wide">Status</th>
                <th className="text-right p-3 font-medium text-xs uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRules.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-0">
                    <EmptyState title="No rules yet" hint="Create a rule above to auto-categorize incoming bank transactions by description, amount, and direction." />
                  </td>
                </tr>
              ) : (
                filteredRules.map((r, idx) => {
                  const isRowBusy = rowBusyId === r.id;
                  const amtLabel = amountRangeLabel(r.min_amount, r.max_amount);
                  return (
                    <tr
                      key={r.id}
                      onDragOver={e => { e.preventDefault(); setOverIndex(idx); }}
                      onDrop={() => handleDrop(idx)}
                      onDragEnd={() => { setDragIndex(null); setOverIndex(null); }}
                      className={[
                        'border-b last:border-b-0 transition-colors hover:bg-muted/80',
                        selectedIds.has(r.id) ? 'bg-muted/40' : '',
                        dragIndex === idx ? 'opacity-40' : '',
                        overIndex === idx && dragIndex !== idx ? 'border-t-2 border-primary' : '',
                      ].join(' ')}
                    >
                      <td
                        className="p-3 w-8 cursor-grab active:cursor-grabbing text-muted-foreground select-none"
                        draggable
                        onDragStart={() => setDragIndex(idx)}
                      >
                        <GripVertical className="h-4 w-4" />
                      </td>
                      <td className="p-3">
                        <input
                          type="checkbox"
                          className="rounded"
                          checked={selectedIds.has(r.id)}
                          onChange={() => toggleRow(r.id)}
                        />
                      </td>
                      <td className="p-3 font-mono">{idx + 1}</td>
                      <td className="p-3 font-medium">{r.name}</td>
                      <td className="p-3">
                        <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold bg-gray-800 text-white tracking-wide">
                          {r.bank_account_id && r.bank_account_name
                            ? r.bank_account_name.toUpperCase()
                            : 'ALL ACCOUNTS'}
                        </span>
                      </td>
                      <td className="p-3 text-muted-foreground max-w-[260px] truncate">
                        Description contains &quot;<span className="text-foreground font-medium">{r.description_contains}</span>&quot;
                        {amtLabel && <span className="ml-1">· Amount {amtLabel}</span>}
                      </td>
                      <td className="p-3 text-muted-foreground max-w-[220px] truncate">
                        Set Category to &quot;{r.offset_account_name}&quot;
                      </td>
                      <td className="p-3">
                        <button
                          type="button"
                          onClick={() => toggleActive(r)}
                          disabled={isRowBusy}
                          className={`text-sm font-medium disabled:opacity-50 ${r.is_active ? 'text-emerald-600' : 'text-muted-foreground'}`}
                        >
                          {r.is_active ? 'Active' : 'Disabled'}
                        </button>
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            className="text-primary hover:underline text-sm font-medium"
                            onClick={() => openEdit(r)}
                            disabled={isRowBusy}
                          >
                            Edit
                          </button>
                          <span className="text-muted-foreground">|</span>
                          <button
                            className="text-destructive hover:underline text-sm"
                            onClick={() => remove(r)}
                            disabled={isRowBusy}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Edit / Create drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/20" onClick={closeDrawer} />
          <div className="w-[420px] bg-background shadow-xl flex flex-col border-l overflow-hidden">
            <div className="flex items-center justify-between border-b px-6 py-4 flex-shrink-0">
              <h2 className="text-lg font-semibold">{drawerMode === 'create' ? 'New rule' : 'Edit rule'}</h2>
              <button type="button" className="text-muted-foreground hover:text-foreground text-lg" onClick={closeDrawer}>✕</button>
            </div>

            <form className="flex flex-col flex-1 overflow-hidden" onSubmit={handleSubmit}>
              <div className="flex-1 overflow-auto p-6 space-y-6">
                <p className="text-sm text-muted-foreground">Rules only apply to unreviewed transactions.</p>

                {/* Rule name */}
                <div>
                  <Label className="text-sm font-medium">What do you want to call this rule? <span className="text-destructive">*</span></Label>
                  <Input
                    className="mt-1"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Stripe payouts"
                    required
                    autoFocus
                  />
                </div>

                {/* Apply to transactions */}
                <div className="space-y-2">
                  <p className="text-sm font-semibold">Apply this to transactions that are</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      className="h-10 rounded-md border bg-background px-3 text-sm"
                      value={form.sign_filter}
                      onChange={e => setForm(f => ({ ...f, sign_filter: e.target.value as SignFilter }))}
                    >
                      {DIRECTION_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    <span className="text-sm text-muted-foreground">in</span>
                    <select
                      className="h-10 rounded-md border bg-background px-3 text-sm"
                      value={form.bank_account_id}
                      onChange={e => setForm(f => ({ ...f, bank_account_id: e.target.value }))}
                    >
                      <option value="">All bank accounts</option>
                      {bankAccounts.filter(ba => ba.is_active).map(ba => (
                        <option key={ba.id} value={ba.id}>{ba.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Conditions */}
                <div className="space-y-2">
                  <p className="text-sm font-semibold">and include the following:</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="h-10 flex items-center px-3 rounded-md border bg-muted/30 text-sm text-muted-foreground">Description</span>
                    <span className="h-10 flex items-center px-3 rounded-md border bg-muted/30 text-sm text-muted-foreground">Contains</span>
                    <Input
                      className="flex-1 min-w-[140px]"
                      value={form.description_contains}
                      onChange={e => setForm(f => ({ ...f, description_contains: e.target.value }))}
                      placeholder="e.g. stripe"
                      required
                    />
                  </div>
                </div>

                {/* Amount range */}
                <div className="space-y-2">
                  <p className="text-sm font-semibold">Amount range <span className="font-normal text-muted-foreground">(optional)</span></p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs text-muted-foreground">Min amount</Label>
                      <Input
                        type="number"
                        step="0.01"
                        className="mt-1"
                        value={form.min_amount}
                        onChange={e => setForm(f => ({ ...f, min_amount: e.target.value }))}
                        placeholder="(optional)"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Max amount</Label>
                      <Input
                        type="number"
                        step="0.01"
                        className="mt-1"
                        value={form.max_amount}
                        onChange={e => setForm(f => ({ ...f, max_amount: e.target.value }))}
                        placeholder="(optional)"
                      />
                    </div>
                  </div>
                </div>

                {/* Priority */}
                <div>
                  <Label className="text-sm font-semibold">Priority</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <Input
                      type="number"
                      step="1"
                      className="w-24"
                      value={form.priority}
                      onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                    />
                    <span className="text-sm text-muted-foreground">Lower numbers run first</span>
                  </div>
                </div>

                {/* Then section */}
                <div className="space-y-3">
                  <p className="text-sm font-semibold">Then</p>
                  <div className="inline-flex rounded-md border overflow-hidden text-sm">
                    <span className="px-3 py-1.5 bg-foreground text-background font-medium">Assign</span>
                    <span className="px-3 py-1.5 text-muted-foreground">Exclude</span>
                  </div>
                  <div>
                    <Label>Category <span className="text-destructive">*</span></Label>
                    <select
                      className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
                      value={form.offset_account_id}
                      onChange={e => setForm(f => ({ ...f, offset_account_id: e.target.value }))}
                      required
                    >
                      <option value="">Select account…</option>
                      {Object.keys(groupedAccounts).sort().map(type => (
                        <optgroup key={type} label={type}>
                          {(groupedAccounts[type] ?? []).map(a => (
                            <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Active toggle — only on edit */}
                {drawerMode === 'edit' && (
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-semibold">Active</Label>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={form.is_active}
                      onClick={() => setForm(f => ({ ...f, is_active: !f.is_active }))}
                      className={`inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.is_active ? 'bg-primary' : 'bg-muted'}`}
                    >
                      <span className={`inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform ${form.is_active ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </button>
                  </div>
                )}

                {err && <p className="text-sm text-destructive">{err}</p>}
              </div>

              <div className="border-t px-6 py-4 flex items-center justify-end gap-2 flex-shrink-0">
                <Button type="button" variant="outline" onClick={closeDrawer}>Cancel</Button>
                <Button type="submit" disabled={formBusy || !formValid}>
                  {formBusy ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
