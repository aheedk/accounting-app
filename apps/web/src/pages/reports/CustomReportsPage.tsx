import { useEffect, useMemo, useState } from 'react';
import { DateInput } from '@/components/ui/date-input';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmtMoney, fmtSigned } from '@/lib/money';
import { todayLocal } from '@/lib/dates';

type GroupBy = 'account' | 'month' | 'cost_center' | 'customer' | 'vendor';
type Column = 'debit' | 'credit' | 'net';

type Definition = {
  account_ids: string[];
  date_range: { from: string; to: string };
  group_by: GroupBy;
  columns: Column[];
};

type SavedReport = {
  id: string;
  business_id: string;
  name: string;
  definition: Definition;
  owner_user_id: string;
  created_at: string;
  updated_at: string;
};

type Account = {
  id: string;
  code: string;
  name: string;
  account_type: string;
  is_active: boolean;
};

type ResultRow = {
  group_key: string;
  debit: string;
  credit: string;
  net: string;
};

const GROUP_BY_OPTIONS: Array<{ value: GroupBy; label: string }> = [
  { value: 'account', label: 'Account' },
  { value: 'month', label: 'Month' },
  { value: 'cost_center', label: 'Cost center' },
  { value: 'customer', label: 'Customer' },
  { value: 'vendor', label: 'Vendor' },
];

const COLUMN_OPTIONS: Array<{ value: Column; label: string }> = [
  { value: 'debit', label: 'Debit' },
  { value: 'credit', label: 'Credit' },
  { value: 'net', label: 'Net' },
];

function todayIso(): string {
  return todayLocal();
}

function startOfYearIso(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-01-01`;
}

function emptyForm(): { name: string; definition: Definition } {
  return {
    name: '',
    definition: {
      account_ids: [],
      date_range: { from: startOfYearIso(), to: todayIso() },
      group_by: 'account',
      columns: ['debit', 'credit', 'net'],
    },
  };
}

function pickErr(e: unknown): string {
  return (e as { response?: { data?: { error?: { message?: string } } } } | undefined)
    ?.response?.data?.error?.message ?? 'Failed';
}

export default function CustomReportsPage() {
  const [bizId] = useActiveBusinessId();
  const [reports, setReports] = useState<SavedReport[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<{ name: string; definition: Definition }>(emptyForm());
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [hasResult, setHasResult] = useState(false);
  const [busy, setBusy] = useState<'idle' | 'save' | 'run' | 'delete'>('idle');
  const [err, setErr] = useState<string | null>(null);

  async function reloadReports() {
    if (!bizId) return;
    const r = await api.get<{ reports: SavedReport[] }>(`/businesses/${bizId}/custom-reports`);
    setReports(r.data.reports);
  }

  useEffect(() => {
    if (!bizId) return;
    (async () => {
      try {
        const [coa] = await Promise.all([
          api.get<{ accounts: Account[] }>(`/businesses/${bizId}/coa`),
          reloadReports(),
        ]);
        setAccounts(coa.data.accounts);
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
      const bucket = groups[a.account_type] ?? [];
      bucket.push(a);
      groups[a.account_type] = bucket;
    }
    for (const k of Object.keys(groups)) {
      groups[k] = (groups[k] ?? []).slice().sort((x, y) => x.code.localeCompare(y.code));
    }
    return groups;
  }, [accounts]);

  function startNew() {
    setSelectedId(null);
    setForm(emptyForm());
    setRows([]);
    setHasResult(false);
    setErr(null);
  }

  function loadSaved(r: SavedReport) {
    setSelectedId(r.id);
    setForm({ name: r.name, definition: r.definition });
    setRows([]);
    setHasResult(false);
    setErr(null);
  }

  function toggleAccount(id: string) {
    setForm(f => {
      const has = f.definition.account_ids.includes(id);
      const next = has
        ? f.definition.account_ids.filter(x => x !== id)
        : [...f.definition.account_ids, id];
      return { ...f, definition: { ...f.definition, account_ids: next } };
    });
  }

  function toggleColumn(col: Column) {
    setForm(f => {
      const has = f.definition.columns.includes(col);
      const next = has
        ? f.definition.columns.filter(x => x !== col)
        : [...f.definition.columns, col];
      return { ...f, definition: { ...f.definition, columns: next } };
    });
  }

  function selectAllAccounts() {
    setForm(f => ({ ...f, definition: { ...f.definition, account_ids: [] } }));
  }

  const validForm =
    form.definition.date_range.from !== '' &&
    form.definition.date_range.to !== '' &&
    form.definition.columns.length > 0;

  async function runOnly() {
    if (!bizId || !validForm) return;
    setBusy('run'); setErr(null);
    try {
      const r = await api.post<{ rows: ResultRow[] }>(
        `/businesses/${bizId}/custom-reports/run`,
        { definition: form.definition },
      );
      setRows(r.data.rows);
      setHasResult(true);
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setBusy('idle');
    }
  }

  async function saveAndRun() {
    if (!bizId || !validForm) return;
    if (form.name.trim() === '') { setErr('Name is required to save.'); return; }
    setBusy('save'); setErr(null);
    try {
      const created = await api.post<SavedReport>(
        `/businesses/${bizId}/custom-reports`,
        { name: form.name.trim(), definition: form.definition },
      );
      await reloadReports();
      setSelectedId(created.data.id);
      const r = await api.post<{ rows: ResultRow[] }>(
        `/businesses/${bizId}/custom-reports/${created.data.id}/run`,
      );
      setRows(r.data.rows);
      setHasResult(true);
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setBusy('idle');
    }
  }

  async function deleteSelected() {
    if (!bizId || !selectedId) return;
    const target = reports.find(r => r.id === selectedId);
    if (!target) return;
    if (!window.confirm(`Delete report "${target.name}"?`)) return;
    setBusy('delete'); setErr(null);
    try {
      await api.delete(`/businesses/${bizId}/custom-reports/${selectedId}`);
      await reloadReports();
      startNew();
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setBusy('idle');
    }
  }

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Custom Reports</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Build ad-hoc reports from posted journal entries with custom filters and groupings.
          </p>
        </div>
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Saved reports</CardTitle>
            <Button size="sm" onClick={startNew}>+ New</Button>
          </CardHeader>
          <CardContent className="p-0">
            {reports.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No saved reports yet.</p>
            ) : (
              <ul className="divide-y">
                {reports.map(r => {
                  const active = r.id === selectedId;
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => loadSaved(r)}
                        className={`w-full px-4 py-3 text-left text-sm transition-colors hover:bg-accent ${active ? 'bg-accent font-medium' : ''}`}
                      >
                        <div className="truncate">{r.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.definition.group_by} · {r.definition.date_range.from} → {r.definition.date_range.to}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">
                {selectedId ? 'Edit report' : 'New report'}
              </CardTitle>
              {selectedId && (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={deleteSelected}
                  disabled={busy !== 'idle'}
                >
                  Delete
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Name</Label>
                <Input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g., Marketing spend by month"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div>
                  <Label>From</Label>
                  <DateInput
                    value={form.definition.date_range.from}
                    onChange={e => setForm(f => ({
                      ...f,
                      definition: { ...f.definition, date_range: { ...f.definition.date_range, from: e.target.value } },
                    }))}
                  />
                </div>
                <div>
                  <Label>To</Label>
                  <DateInput
                    value={form.definition.date_range.to}
                    onChange={e => setForm(f => ({
                      ...f,
                      definition: { ...f.definition, date_range: { ...f.definition.date_range, to: e.target.value } },
                    }))}
                  />
                </div>
                <div>
                  <Label>Group by</Label>
                  <select
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={form.definition.group_by}
                    onChange={e => setForm(f => ({
                      ...f,
                      definition: { ...f.definition, group_by: e.target.value as GroupBy },
                    }))}
                  >
                    {GROUP_BY_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <Label>Columns</Label>
                <div className="mt-1 flex flex-wrap gap-4">
                  {COLUMN_OPTIONS.map(c => (
                    <label key={c.value} className="inline-flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={form.definition.columns.includes(c.value)}
                        onChange={() => toggleColumn(c.value)}
                      />
                      {c.label}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <Label>Accounts ({form.definition.account_ids.length === 0 ? 'all' : form.definition.account_ids.length})</Label>
                  {form.definition.account_ids.length > 0 && (
                    <Button type="button" size="sm" variant="ghost" onClick={selectAllAccounts}>
                      Clear (use all)
                    </Button>
                  )}
                </div>
                <div className="max-h-64 overflow-y-auto rounded-md border">
                  {Object.keys(groupedAccounts).length === 0 ? (
                    <p className="p-3 text-sm text-muted-foreground">No active accounts.</p>
                  ) : (
                    Object.keys(groupedAccounts).sort().map(type => (
                      <div key={type} className="border-b last:border-b-0">
                        <div className="bg-muted/40 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {type}
                        </div>
                        <ul>
                          {(groupedAccounts[type] ?? []).map(a => (
                            <li key={a.id} className="border-b last:border-b-0">
                              <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4"
                                  checked={form.definition.account_ids.includes(a.id)}
                                  onChange={() => toggleAccount(a.id)}
                                />
                                <span className="font-mono text-xs">{a.code}</span>
                                <span>{a.name}</span>
                              </label>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Leave empty to include all accounts.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={saveAndRun}
                  disabled={!validForm || form.name.trim() === '' || busy !== 'idle'}
                >
                  {busy === 'save' ? 'Saving…' : 'Save & Run'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={runOnly}
                  disabled={!validForm || busy !== 'idle'}
                >
                  {busy === 'run' ? 'Running…' : 'Run without saving'}
                </Button>
              </div>
            </CardContent>
          </Card>

          {hasResult && (
            <Card>
              <CardHeader><CardTitle className="text-base">Result</CardTitle></CardHeader>
              <CardContent className="p-0">
                {rows.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">No matching journal activity for the selected filters.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="border-b bg-muted/40">
                      <tr>
                        <th className="text-left p-3">{groupColumnLabel(form.definition.group_by)}</th>
                        {form.definition.columns.includes('debit') && <th className="text-right p-3">Debit</th>}
                        {form.definition.columns.includes('credit') && <th className="text-right p-3">Credit</th>}
                        {form.definition.columns.includes('net') && <th className="text-right p-3">Net</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(r => (
                        <tr key={r.group_key} className="border-b last:border-b-0">
                          <td className="p-3">{r.group_key}</td>
                          {form.definition.columns.includes('debit') && (
                            <td className="p-3 text-right font-mono">{fmtMoney(r.debit)}</td>
                          )}
                          {form.definition.columns.includes('credit') && (
                            <td className="p-3 text-right font-mono">{fmtMoney(r.credit)}</td>
                          )}
                          {form.definition.columns.includes('net') && (
                            <td className="p-3 text-right font-mono">{fmtSigned(r.net)}</td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function groupColumnLabel(g: GroupBy): string {
  switch (g) {
    case 'account': return 'Account';
    case 'month': return 'Month';
    case 'cost_center': return 'Cost center';
    case 'customer': return 'Customer';
    case 'vendor': return 'Vendor';
  }
}
