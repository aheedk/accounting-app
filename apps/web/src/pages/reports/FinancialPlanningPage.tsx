import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fmtMoney, fmtSigned } from '@/lib/money';
import { currentYearLocal } from '@/lib/dates';

type Budget = {
  id: string;
  business_id: string;
  name: string;
  fiscal_year: number;
  status: 'draft' | 'active' | 'archived';
  created_at: string;
  updated_at: string;
};

type BudgetLine = {
  id: string;
  budget_id: string;
  account_id: string;
  month_offset: number;
  amount: string;
};

type Account = {
  id: string;
  code: string;
  name: string;
  account_type: string;
  is_system: boolean;
  is_active: boolean;
};

type BudgetWithLines = Budget & { lines: BudgetLine[] };

type VarianceRow = {
  account_id: string;
  account_code: string;
  account_name: string;
  month_offset: number;
  budget: string;
  actual: string;
  variance: string;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

type Mode = 'edit' | 'variance';

function lineKey(account_id: string, month_offset: number): string {
  return `${account_id}:${month_offset}`;
}

function varianceClass(variance: string): string {
  const v = parseFloat(variance);
  if (v > 0) return 'text-emerald-600';
  if (v < 0) return 'text-rose-600';
  return 'text-muted-foreground';
}

function statusBadge(status: 'draft' | 'active' | 'archived') {
  const base = 'inline-flex rounded-full px-2 py-0.5 text-xs font-medium';
  switch (status) {
    case 'active':
      return <span className={`${base} bg-emerald-100 text-emerald-800`}>Active</span>;
    case 'archived':
      return <span className={`${base} bg-muted text-muted-foreground`}>Archived</span>;
    default:
      return <span className={`${base} bg-amber-100 text-amber-800`}>Draft</span>;
  }
}

export default function FinancialPlanningPage() {
  const [bizId] = useActiveBusinessId();
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [budget, setBudget] = useState<BudgetWithLines | null>(null);
  const [mode, setMode] = useState<Mode>('edit');
  const [variance, setVariance] = useState<VarianceRow[]>([]);
  const [cells, setCells] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [newYear, setNewYear] = useState<string>(String(currentYearLocal()));

  const loadBudgets = useCallback(async () => {
    if (!bizId) return;
    const r = await api.get<{ budgets: Budget[] }>(`/businesses/${bizId}/budgets`);
    setBudgets(r.data.budgets);
  }, [bizId]);

  const loadAccounts = useCallback(async () => {
    if (!bizId) return;
    const r = await api.get<{ accounts: Account[] }>(`/businesses/${bizId}/coa`);
    setAccounts(r.data.accounts.filter(a => a.is_active));
  }, [bizId]);

  const loadBudget = useCallback(async () => {
    if (!bizId || !selectedId) { setBudget(null); setCells({}); return; }
    const r = await api.get<BudgetWithLines>(`/businesses/${bizId}/budgets/${selectedId}`);
    setBudget(r.data);
    const next: Record<string, string> = {};
    for (const line of r.data.lines) {
      next[lineKey(line.account_id, line.month_offset)] = line.amount;
    }
    setCells(next);
  }, [bizId, selectedId]);

  const loadVariance = useCallback(async () => {
    if (!bizId || !selectedId) { setVariance([]); return; }
    const r = await api.get<{ rows: VarianceRow[] }>(`/businesses/${bizId}/budgets/${selectedId}/variance`);
    setVariance(r.data.rows);
  }, [bizId, selectedId]);

  useEffect(() => { loadBudgets(); }, [loadBudgets]);
  useEffect(() => { loadAccounts(); }, [loadAccounts]);
  useEffect(() => { loadBudget(); }, [loadBudget]);
  useEffect(() => { if (mode === 'variance') loadVariance(); }, [mode, loadVariance]);

  async function createBudget(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!bizId || !newName.trim()) return;
    try {
      const created = await api.post<Budget>(`/businesses/${bizId}/budgets`, {
        name: newName.trim(),
        fiscal_year: Number(newYear),
      });
      setNewName('');
      await loadBudgets();
      setSelectedId(created.data.id);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed to create budget');
    }
  }

  async function saveCell(account_id: string, month_offset: number, raw: string) {
    if (!bizId || !selectedId) return;
    setErr(null);
    const trimmed = raw.trim() === '' ? '0' : raw.trim();
    // Validate as a money string the API accepts
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
      setErr(`Invalid amount: ${raw}`);
      return;
    }
    try {
      await api.patch(`/businesses/${bizId}/budgets/${selectedId}/lines`, {
        account_id,
        month_offset,
        amount: trimmed,
      });
      setCells(prev => ({ ...prev, [lineKey(account_id, month_offset)]: trimmed }));
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed to save cell');
    }
  }

  async function updateStatus(status: 'draft' | 'active' | 'archived') {
    if (!bizId || !selectedId) return;
    try {
      await api.patch(`/businesses/${bizId}/budgets/${selectedId}`, { status });
      await loadBudgets();
      await loadBudget();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed to update status');
    }
  }

  async function deleteBudget() {
    if (!bizId || !selectedId) return;
    if (!confirm('Delete this budget and all of its lines?')) return;
    try {
      await api.delete(`/businesses/${bizId}/budgets/${selectedId}`);
      setSelectedId(null);
      setBudget(null);
      setCells({});
      await loadBudgets();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed to delete budget');
    }
  }

  const varianceByCell = useMemo(() => {
    const map: Record<string, VarianceRow> = {};
    for (const row of variance) {
      map[lineKey(row.account_id, row.month_offset)] = row;
    }
    return map;
  }, [variance]);

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Financial Planning</h1>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
        {/* Left: budgets list + new */}
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>New budget</CardTitle></CardHeader>
            <CardContent>
              <form className="space-y-3" onSubmit={createBudget}>
                <div>
                  <Label>Name</Label>
                  <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="FY26 Plan" />
                </div>
                <div>
                  <Label>Fiscal year</Label>
                  <Input type="number" value={newYear} onChange={e => setNewYear(e.target.value)} min={2000} max={2100} />
                </div>
                <Button type="submit">Create</Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Budgets</CardTitle></CardHeader>
            <CardContent className="p-0">
              {budgets.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">No budgets yet</div>
              ) : (
                <ul className="divide-y">
                  {budgets.map(b => (
                    <li key={b.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(b.id)}
                        className={`w-full px-4 py-3 text-left hover:bg-muted/40 ${selectedId === b.id ? 'bg-muted/60' : ''}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{b.name}</span>
                          {statusBadge(b.status)}
                        </div>
                        <div className="text-xs text-muted-foreground">FY {b.fiscal_year}</div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: editor / variance */}
        <div className="space-y-4">
          {!budget && (
            <Card>
              <CardContent className="p-12 text-center text-sm text-muted-foreground">
                Select a budget on the left to edit it, or create a new one.
              </CardContent>
            </Card>
          )}

          {budget && (
            <>
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-4">
                    <CardTitle>
                      {budget.name} <span className="text-sm font-normal text-muted-foreground">FY {budget.fiscal_year}</span>
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <div className="inline-flex rounded-md border">
                        <button
                          type="button"
                          className={`px-3 py-1 text-sm ${mode === 'edit' ? 'bg-muted font-medium' : ''}`}
                          onClick={() => setMode('edit')}
                        >Edit</button>
                        <button
                          type="button"
                          className={`px-3 py-1 text-sm border-l ${mode === 'variance' ? 'bg-muted font-medium' : ''}`}
                          onClick={() => setMode('variance')}
                        >Variance</button>
                      </div>
                      <select
                        className="h-9 rounded-md border bg-background px-2 text-sm"
                        value={budget.status}
                        onChange={e => updateStatus(e.target.value as 'draft' | 'active' | 'archived')}
                      >
                        <option value="draft">draft</option>
                        <option value="active">active</option>
                        <option value="archived">archived</option>
                      </select>
                      <Button variant="outline" onClick={deleteBudget}>Delete</Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {err && <p className="px-6 pb-3 text-sm text-destructive">{err}</p>}
                  <div className="overflow-x-auto">
                    {mode === 'edit' ? (
                      <table className="w-full text-sm">
                        <thead className="border-b bg-muted/40">
                          <tr>
                            <th className="text-left p-2 sticky left-0 bg-muted/40 z-10">Code</th>
                            <th className="text-left p-2 sticky left-[80px] bg-muted/40 z-10">Account</th>
                            {MONTHS.map(m => (
                              <th key={m} className="text-right p-2 min-w-[90px]">{m}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {accounts.length === 0 ? (
                            <tr><td colSpan={14} className="p-6 text-center text-muted-foreground">No accounts</td></tr>
                          ) : accounts.map(a => (
                            <tr key={a.id} className="border-b last:border-b-0">
                              <td className="p-2 font-mono sticky left-0 bg-background">{a.code}</td>
                              <td className="p-2 sticky left-[80px] bg-background">{a.name}</td>
                              {MONTHS.map((_, mi) => {
                                const k = lineKey(a.id, mi);
                                const value = cells[k] ?? '0';
                                return (
                                  <td key={mi} className="p-1">
                                    <input
                                      type="text"
                                      defaultValue={value}
                                      key={`${k}:${value}`}
                                      onBlur={e => {
                                        if (e.target.value !== value) saveCell(a.id, mi, e.target.value);
                                      }}
                                      className="h-8 w-full rounded border bg-background px-2 text-right text-sm"
                                    />
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <table className="w-full text-sm">
                        <thead className="border-b bg-muted/40">
                          <tr>
                            <th className="text-left p-2 sticky left-0 bg-muted/40 z-10">Code</th>
                            <th className="text-left p-2 sticky left-[80px] bg-muted/40 z-10">Account</th>
                            {MONTHS.map(m => (
                              <th key={m} className="text-right p-2 min-w-[110px]">{m}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {accounts.length === 0 ? (
                            <tr><td colSpan={14} className="p-6 text-center text-muted-foreground">No accounts</td></tr>
                          ) : accounts.map(a => (
                            <tr key={a.id} className="border-b last:border-b-0 align-top">
                              <td className="p-2 font-mono sticky left-0 bg-background">{a.code}</td>
                              <td className="p-2 sticky left-[80px] bg-background">{a.name}</td>
                              {MONTHS.map((_, mi) => {
                                const row = varianceByCell[lineKey(a.id, mi)];
                                const b = row?.budget ?? '0';
                                const act = row?.actual ?? '0';
                                const v = row?.variance ?? '0';
                                return (
                                  <td key={mi} className="p-2 text-right">
                                    <div className="text-xs text-muted-foreground">B {fmtMoney(b)}</div>
                                    <div className="text-xs">A {fmtMoney(act)}</div>
                                    <div className={`text-xs font-medium ${varianceClass(v)}`}>V {fmtSigned(v)}</div>
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
