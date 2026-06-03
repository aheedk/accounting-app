import { useEffect, useMemo, useState } from 'react';
import { DateInput } from '@/components/ui/date-input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useActiveBusinessId } from '@/lib/business';
import { api } from '@/lib/apiClient';
import { fmtMoney, parseMoneyInput } from '@/lib/money';
import { DownloadButtons } from '@/components/ui/DownloadButtons';

type Account = { id: string; code: string; name: string; account_type: string };

type Recurrence = 'weekly' | 'monthly' | 'quarterly' | 'yearly';
type TemplateType = 'journal_entry' | 'invoice' | 'bill';

type Template = {
  id: string;
  business_id: string;
  name: string;
  template_type: TemplateType;
  payload: unknown;
  recurrence: Recurrence;
  next_run_date: string;
  end_date: string | null;
  last_run_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type RunDueResult = {
  results: Array<{ template_id: string; runs_created: number }>;
};

type Line = { account_id: string; debit: string; credit: string; memo: string };

const blankLine = (): Line => ({ account_id: '', debit: '0.00', credit: '0.00', memo: '' });

const blankForm = () => ({
  name: '',
  template_type: 'journal_entry' as TemplateType,
  recurrence: 'monthly' as Recurrence,
  next_run_date: new Date().toISOString().slice(0, 10),
  end_date: '',
  memo: '',
  reference: '',
});

function pickErr(e: unknown): string {
  return (
    (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data
      ?.error?.message ?? 'Failed'
  );
}

export default function RecurringTransactionsPage() {
  const [bizId] = useActiveBusinessId();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);
  const [runErr, setRunErr] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const [form, setForm] = useState(blankForm());
  const [lines, setLines] = useState<Line[]>([blankLine(), blankLine()]);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reload() {
    if (!bizId) return;
    api
      .get<{ templates: Template[] }>(`/businesses/${bizId}/recurring-templates`)
      .then((r) => setTemplates(r.data.templates))
      .catch(() => undefined);
    api
      .get<{ accounts: Account[] }>(`/businesses/${bizId}/coa`)
      .then((r) => setAccounts(r.data.accounts))
      .catch(() => undefined);
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bizId]);

  const today = new Date().toISOString().slice(0, 10);
  const due = useMemo(
    () => templates.filter((t) => t.is_active && t.next_run_date <= today),
    [templates, today],
  );

  const totalD = lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  const totalC = lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const balanced = Math.abs(totalD - totalC) < 0.005 && totalD > 0;

  function resetForm() {
    setForm(blankForm());
    setLines([blankLine(), blankLine()]);
    setFormErr(null);
  }

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function runDue() {
    if (!bizId) return;
    setRunning(true);
    setRunErr(null);
    setRunResult(null);
    try {
      const r = await api.post<RunDueResult>(
        `/businesses/${bizId}/recurring-templates/run-due`,
        {},
      );
      const total = r.data.results.reduce((s, x) => s + x.runs_created, 0);
      setRunResult(`Created ${total} entries across ${r.data.results.length} templates.`);
      reload();
    } catch (e: unknown) {
      setRunErr(pickErr(e));
    } finally {
      setRunning(false);
    }
  }

  async function deleteTemplate(id: string) {
    if (!bizId) return;
    if (!confirm('Delete this template?')) return;
    try {
      await api.delete(`/businesses/${bizId}/recurring-templates/${id}`);
      reload();
    } catch (e: unknown) {
      setRunErr(pickErr(e));
    }
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    if (!bizId) return;
    setFormErr(null);

    // Per-line validation: exactly one of debit/credit must be > 0.
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]!;
      const d = parseFloat(l.debit) || 0;
      const c = parseFloat(l.credit) || 0;
      if (!l.account_id) {
        setFormErr(`Line ${i + 1}: select an account.`);
        return;
      }
      if (d > 0 && c > 0) {
        setFormErr(`Line ${i + 1}: only one of debit or credit may be > 0.`);
        return;
      }
      if (d === 0 && c === 0) {
        setFormErr(`Line ${i + 1}: enter a debit or credit amount.`);
        return;
      }
    }
    if (!balanced) {
      setFormErr('Total debit must equal total credit.');
      return;
    }

    setBusy(true);
    try {
      const payload = {
        memo: form.memo || null,
        reference: form.reference || null,
        lines: lines.map((l) => ({
          account_id: l.account_id,
          debit: parseMoneyInput(l.debit || '0'),
          credit: parseMoneyInput(l.credit || '0'),
          memo: l.memo || null,
        })),
      };
      await api.post(`/businesses/${bizId}/recurring-templates`, {
        name: form.name,
        template_type: 'journal_entry',
        payload,
        recurrence: form.recurrence,
        next_run_date: form.next_run_date,
        end_date: form.end_date || null,
      });
      resetForm();
      setShowForm(false);
      reload();
    } catch (e: unknown) {
      setFormErr(pickErr(e));
    } finally {
      setBusy(false);
    }
  }

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Recurring Transactions</h1>
        <DownloadButtons
          headers={['Name', 'Type', 'Next Run', 'Last Run', 'Active']}
          getRows={() => templates.map(t => [t.name, t.template_type, t.next_run_date, t.last_run_at ?? '—', t.is_active ? 'Yes' : 'No'])}
          filename="recurring-transactions"
          title="Recurring Transactions"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Due now ({due.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {due.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing due today.</p>
          ) : (
            <ul className="text-sm divide-y">
              {due.map((t) => (
                <li key={t.id} className="py-2 flex justify-between">
                  <span>{t.name}</span>
                  <span className="font-mono text-muted-foreground">
                    {t.recurrence} — next {t.next_run_date}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-3 pt-2">
            <Button onClick={runDue} disabled={running || due.length === 0}>
              {running ? 'Running…' : 'Run all due'}
            </Button>
            {runResult && <span className="text-sm text-green-600">{runResult}</span>}
            {runErr && <span className="text-sm text-destructive">{runErr}</span>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>All templates</span>
            <Button
              size="sm"
              onClick={() => {
                setShowForm((s) => !s);
                if (showForm) resetForm();
              }}
            >
              {showForm ? 'Cancel' : '+ New template'}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {showForm && (
            <form className="space-y-4 border rounded-md p-4" onSubmit={submitForm}>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Name</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <Label>Template type</Label>
                  <select
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={form.template_type}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, template_type: e.target.value as TemplateType }))
                    }
                    required
                  >
                    <option value="journal_entry">Journal entry</option>
                    <option value="invoice" disabled title="Coming in a future polish slice.">
                      Invoice (coming soon)
                    </option>
                    <option value="bill" disabled title="Coming in a future polish slice.">
                      Bill (coming soon)
                    </option>
                  </select>
                </div>
                <div>
                  <Label>Recurrence</Label>
                  <select
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={form.recurrence}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, recurrence: e.target.value as Recurrence }))
                    }
                    required
                  >
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>
                <div>
                  <Label>Next run date</Label>
                  <DateInput
                    value={form.next_run_date}
                    onChange={(e) => setForm((f) => ({ ...f, next_run_date: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <Label>End date (optional)</Label>
                  <DateInput
                    value={form.end_date}
                    onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>Reference</Label>
                  <Input
                    value={form.reference}
                    onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
                  />
                </div>
                <div className="col-span-2">
                  <Label>Memo</Label>
                  <Input
                    value={form.memo}
                    onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Lines</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setLines((ls) => [...ls, blankLine()])}
                  >
                    + Add line
                  </Button>
                </div>
                {lines.map((l, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-4">
                      <Label className="sr-only">Account</Label>
                      <select
                        className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                        value={l.account_id}
                        onChange={(e) => updateLine(i, { account_id: e.target.value })}
                        required
                      >
                        <option value="">Select account…</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} — {a.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-2">
                      <Label className="sr-only">Debit</Label>
                      <Input
                        type="number"
                        step="0.0001"
                        min="0"
                        value={l.debit}
                        onChange={(e) => updateLine(i, { debit: e.target.value, credit: '0.00' })}
                      />
                    </div>
                    <div className="col-span-2">
                      <Label className="sr-only">Credit</Label>
                      <Input
                        type="number"
                        step="0.0001"
                        min="0"
                        value={l.credit}
                        onChange={(e) => updateLine(i, { credit: e.target.value, debit: '0.00' })}
                      />
                    </div>
                    <div className="col-span-3">
                      <Label className="sr-only">Memo</Label>
                      <Input
                        value={l.memo}
                        onChange={(e) => updateLine(i, { memo: e.target.value })}
                        placeholder="Line memo"
                      />
                    </div>
                    <div className="col-span-1">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() =>
                          setLines((ls) => ls.filter((_, idx) => idx !== i))
                        }
                        disabled={lines.length <= 2}
                      >
                        ×
                      </Button>
                    </div>
                  </div>
                ))}

                <div className="flex justify-end gap-8 pt-3 border-t font-mono text-sm">
                  <div>Total Debit: {fmtMoney(totalD)}</div>
                  <div>Total Credit: {fmtMoney(totalC)}</div>
                  <div className={balanced ? 'text-green-600' : 'text-destructive'}>
                    {balanced ? 'BALANCED' : 'UNBALANCED'}
                  </div>
                </div>
              </div>

              {formErr && <p className="text-sm text-destructive">{formErr}</p>}

              <div className="flex gap-2">
                <Button type="submit" disabled={busy || !balanced}>
                  {busy ? 'Saving…' : 'Create template'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowForm(false);
                    resetForm();
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}

          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="text-left p-3">Name</th>
                <th className="text-left p-3">Type</th>
                <th className="text-left p-3">Recurrence</th>
                <th className="text-left p-3">Next run</th>
                <th className="text-left p-3">Last run</th>
                <th className="text-left p-3">Active</th>
                <th className="text-right p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {templates.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-4 text-center text-muted-foreground">
                    No templates yet.
                  </td>
                </tr>
              ) : (
                templates.map((t) => (
                  <tr key={t.id} className="border-b last:border-b-0">
                    <td className="p-3">{t.name}</td>
                    <td className="p-3">{t.template_type}</td>
                    <td className="p-3">{t.recurrence}</td>
                    <td className="p-3 font-mono">{t.next_run_date}</td>
                    <td className="p-3 font-mono">
                      {t.last_run_at ? t.last_run_at.slice(0, 10) : '—'}
                    </td>
                    <td className="p-3">
                      <input type="checkbox" checked={t.is_active} disabled readOnly />
                    </td>
                    <td className="p-3 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => deleteTemplate(t.id)}
                      >
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
