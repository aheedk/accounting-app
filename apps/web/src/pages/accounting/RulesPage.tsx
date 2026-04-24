import { Fragment, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmtMoney } from '@/lib/money';

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
  priority: string;
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
  sign_filter: 'any',
  offset_account_id: '',
  priority: '100',
};

const SIGN_FILTER_OPTIONS: Array<{ value: SignFilter; label: string }> = [
  { value: 'any', label: 'any' },
  { value: 'inflow_only', label: 'inflow only' },
  { value: 'outflow_only', label: 'outflow only' },
];

function pickErr(e: unknown): string {
  return (e as { response?: { data?: { error?: { message?: string } } } } | undefined)
    ?.response?.data?.error?.message ?? 'Failed';
}

function amountRangeLabel(min: string | null, max: string | null): string {
  if (min == null && max == null) return 'any';
  if (min != null && max != null) return `${fmtMoney(min)}–${fmtMoney(max)}`;
  if (min != null) return `>= ${fmtMoney(min)}`;
  if (max != null) return `<= ${fmtMoney(max)}`;
  return 'any';
}

function ruleToForm(r: Rule): RuleFormState {
  return {
    name: r.name,
    description_contains: r.description_contains,
    min_amount: r.min_amount ?? '',
    max_amount: r.max_amount ?? '',
    sign_filter: r.sign_filter,
    offset_account_id: r.offset_account_id,
    priority: String(r.priority),
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
  return body;
}

function formToPatchBody(form: RuleFormState): PatchBody {
  const priorityNum = Number.parseInt(form.priority, 10);
  const patch: PatchBody = {
    name: form.name.trim(),
    description_contains: form.description_contains.trim(),
    offset_account_id: form.offset_account_id,
    sign_filter: form.sign_filter,
    priority: Number.isFinite(priorityNum) ? priorityNum : 100,
    min_amount: form.min_amount.trim() === '' ? null : form.min_amount.trim(),
    max_amount: form.max_amount.trim() === '' ? null : form.max_amount.trim(),
  };
  return patch;
}

export default function RulesPage() {
  const [bizId] = useActiveBusinessId();
  const [rules, setRules] = useState<Rule[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);

  const [applyBankAccountId, setApplyBankAccountId] = useState<string>('');
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [applyBusy, setApplyBusy] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<RuleFormState>(EMPTY_FORM);
  const [createBusy, setCreateBusy] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<RuleFormState>(EMPTY_FORM);
  const [editBusy, setEditBusy] = useState(false);

  const [rowBusyId, setRowBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

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

  function renderOffsetAccountOptions() {
    return Object.keys(groupedAccounts).sort().map(type => {
      const bucket = groupedAccounts[type] ?? [];
      return (
        <optgroup key={type} label={type}>
          {bucket.map(a => (
            <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
          ))}
        </optgroup>
      );
    });
  }

  async function apply(e: React.FormEvent) {
    e.preventDefault();
    if (!bizId || !applyBankAccountId) return;
    setApplyBusy(true); setErr(null); setApplyResult(null);
    try {
      // Fetch unreviewed count beforehand so we can show "N of M".
      const before = await api.get(`/businesses/${bizId}/bank-transactions`, {
        params: { bank_account_id: applyBankAccountId, status: 'unreviewed' },
      });
      const unreviewedBefore: number = (before.data.bank_transactions as BankTransaction[]).length;
      const r = await api.post(`/businesses/${bizId}/bank-rules/apply`, {
        bank_account_id: applyBankAccountId,
      });
      const applied: number = r.data.applied;
      const rulesTried: number = r.data.rules_tried;
      setApplyResult({ applied, rules_tried: rulesTried, unreviewed_before: unreviewedBefore });
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setApplyBusy(false);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!bizId) return;
    setCreateBusy(true); setErr(null);
    try {
      await api.post(`/businesses/${bizId}/bank-rules`, formToCreateBody(createForm));
      setCreateForm(EMPTY_FORM);
      setShowCreate(false);
      await reload();
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setCreateBusy(false);
    }
  }

  function startEdit(r: Rule) {
    setErr(null);
    setEditingId(r.id);
    setEditForm(ruleToForm(r));
  }
  function cancelEdit() {
    setEditingId(null);
    setEditForm(EMPTY_FORM);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!bizId || !editingId) return;
    setEditBusy(true); setErr(null);
    try {
      await api.patch(`/businesses/${bizId}/bank-rules/${editingId}`, formToPatchBody(editForm));
      cancelEdit();
      await reload();
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setEditBusy(false);
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
      if (editingId === r.id) cancelEdit();
      await reload();
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setRowBusyId(null);
    }
  }

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Bank Rules</h1>
        <Button onClick={() => { setShowCreate(s => !s); setErr(null); }}>
          {showCreate ? 'Cancel' : 'New rule'}
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle>Apply rules to inbox</CardTitle></CardHeader>
        <CardContent>
          {bankAccounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No bank accounts yet.</p>
          ) : (
            <form className="grid grid-cols-1 gap-3 md:grid-cols-3 md:items-end" onSubmit={apply}>
              <div>
                <Label>Bank account</Label>
                <select
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={applyBankAccountId}
                  onChange={e => setApplyBankAccountId(e.target.value)}
                >
                  {bankAccounts.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.name}{b.account_last_four ? ` ••${b.account_last_four}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex">
                <Button type="submit" disabled={applyBusy || !applyBankAccountId}>
                  {applyBusy ? 'Applying…' : 'Apply rules to unreviewed'}
                </Button>
              </div>
              <div className="text-sm text-muted-foreground md:text-right">
                {applyResult && (
                  <span>
                    Categorized {applyResult.applied} of {applyResult.unreviewed_before} unreviewed transactions
                    {' '}({applyResult.rules_tried} rule{applyResult.rules_tried === 1 ? '' : 's'} tried).
                  </span>
                )}
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      {err && <p className="text-sm text-destructive">{err}</p>}

      {showCreate && (
        <Card>
          <CardHeader><CardTitle>New rule</CardTitle></CardHeader>
          <CardContent>
            <RuleForm
              form={createForm}
              setForm={setCreateForm}
              submitLabel={createBusy ? 'Creating…' : 'Create'}
              busy={createBusy}
              onSubmit={create}
              accountsSelect={renderOffsetAccountOptions()}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="text-left p-3">Name</th>
                <th className="text-left p-3">Description contains</th>
                <th className="text-left p-3">Amount range</th>
                <th className="text-left p-3">Sign filter</th>
                <th className="text-left p-3">Offset account</th>
                <th className="text-right p-3">Priority</th>
                <th className="text-left p-3">Active</th>
                <th className="text-left p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rules.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-muted-foreground">
                    No rules yet. Create one above to auto-categorize bank transactions.
                  </td>
                </tr>
              )}
              {rules.map(r => {
                const isEditing = editingId === r.id;
                const isRowBusy = rowBusyId === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr className="border-b last:border-b-0">
                      <td className="p-3 font-medium">{r.name}</td>
                      <td className="p-3">{r.description_contains}</td>
                      <td className="p-3 font-mono">{amountRangeLabel(r.min_amount, r.max_amount)}</td>
                      <td className="p-3">{r.sign_filter}</td>
                      <td className="p-3 font-mono">{r.offset_account_code} — {r.offset_account_name}</td>
                      <td className="p-3 text-right font-mono">{r.priority}</td>
                      <td className="p-3">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={r.is_active}
                          onClick={() => toggleActive(r)}
                          disabled={isRowBusy}
                          className={`inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${r.is_active ? 'bg-primary' : 'bg-muted'}`}
                        >
                          <span
                            className={`inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform ${r.is_active ? 'translate-x-5' : 'translate-x-0.5'}`}
                          />
                        </button>
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1">
                          {!isEditing && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => startEdit(r)}
                              disabled={isRowBusy}
                            >
                              Edit
                            </Button>
                          )}
                          {isEditing && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={cancelEdit}
                              disabled={editBusy}
                            >
                              Cancel
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => remove(r)}
                            disabled={isRowBusy}
                          >
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {isEditing && (
                      <tr className="bg-muted/20">
                        <td colSpan={8} className="p-4">
                          <RuleForm
                            form={editForm}
                            setForm={setEditForm}
                            submitLabel={editBusy ? 'Saving…' : 'Save'}
                            busy={editBusy}
                            onSubmit={saveEdit}
                            accountsSelect={renderOffsetAccountOptions()}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

type RuleFormProps = {
  form: RuleFormState;
  setForm: React.Dispatch<React.SetStateAction<RuleFormState>>;
  submitLabel: string;
  busy: boolean;
  onSubmit: (e: React.FormEvent) => void | Promise<void>;
  accountsSelect: React.ReactNode;
};

function RuleForm({ form, setForm, submitLabel, busy, onSubmit, accountsSelect }: RuleFormProps) {
  const submitDisabled =
    busy ||
    form.name.trim() === '' ||
    form.description_contains.trim() === '' ||
    form.offset_account_id === '';
  return (
    <form className="space-y-3" onSubmit={onSubmit}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <Label>Name</Label>
          <Input
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="Stripe payouts"
          />
        </div>
        <div>
          <Label>Description contains</Label>
          <Input
            value={form.description_contains}
            onChange={e => setForm(f => ({ ...f, description_contains: e.target.value }))}
            placeholder="stripe"
            required
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div>
          <Label>Min amount</Label>
          <Input
            type="number"
            step="0.01"
            value={form.min_amount}
            onChange={e => setForm(f => ({ ...f, min_amount: e.target.value }))}
            placeholder="(optional)"
          />
        </div>
        <div>
          <Label>Max amount</Label>
          <Input
            type="number"
            step="0.01"
            value={form.max_amount}
            onChange={e => setForm(f => ({ ...f, max_amount: e.target.value }))}
            placeholder="(optional)"
          />
        </div>
        <div>
          <Label>Sign filter</Label>
          <select
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            value={form.sign_filter}
            onChange={e => setForm(f => ({ ...f, sign_filter: e.target.value as SignFilter }))}
          >
            {SIGN_FILTER_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <Label>Priority</Label>
          <Input
            type="number"
            step="1"
            value={form.priority}
            onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
          />
        </div>
      </div>
      <div>
        <Label>Offset account</Label>
        <select
          className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          value={form.offset_account_id}
          onChange={e => setForm(f => ({ ...f, offset_account_id: e.target.value }))}
          required
        >
          <option value="">Select account…</option>
          {accountsSelect}
        </select>
      </div>
      <div>
        <Button type="submit" disabled={submitDisabled}>{submitLabel}</Button>
      </div>
    </form>
  );
}
