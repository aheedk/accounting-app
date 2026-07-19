import { useEffect, useMemo, useState } from 'react';
import { FileDown, Printer } from 'lucide-react';
import { DateInput } from '@/components/ui/date-input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useActiveBusinessId } from '@/lib/business';
import { api } from '@/lib/apiClient';
import { fmtMoney, parseMoneyInput } from '@/lib/money';
import { todayLocal } from '@/lib/dates';
import { downloadAsExcel } from '@/lib/download';

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
  next_run_date: todayLocal(),
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

const INTERVAL_LABELS: Record<Recurrence, string> = {
  weekly: 'Every Week',
  monthly: 'Every Month',
  quarterly: 'Every Quarter',
  yearly: 'Every Year',
};

const TXN_TYPE_LABELS: Record<TemplateType, string> = {
  bill: 'Bill',
  invoice: 'Invoice',
  journal_entry: 'Journal Entry',
};

const TXN_TYPE_OPTIONS: Array<{ value: TemplateType; label: string; disabled?: boolean; title?: string }> = [
  { value: 'journal_entry', label: 'Journal Entry' },
  { value: 'invoice', label: 'Invoice (coming soon)', disabled: true, title: 'Coming in a future polish slice.' },
  { value: 'bill', label: 'Bill (coming soon)', disabled: true, title: 'Coming in a future polish slice.' },
];

function fmtShortDate(iso: string | null) {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  if (!y || !m || !d) return iso;
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
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
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  // Filter state
  const [nameFilter, setNameFilter] = useState('');
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [pendingTemplateType, setPendingTemplateType] = useState('');
  const [pendingTxnType, setPendingTxnType] = useState('');
  const [appliedTemplateType, setAppliedTemplateType] = useState('');
  const [appliedTxnType, setAppliedTxnType] = useState('');

  const [excelBusy, setExcelBusy] = useState(false);

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

  const filteredTemplates = useMemo(() => templates.filter(t => {
    if (nameFilter && !t.name.toLowerCase().includes(nameFilter.toLowerCase())) return false;
    if (appliedTemplateType && t.recurrence !== appliedTemplateType) return false;
    if (appliedTxnType && t.template_type !== appliedTxnType) return false;
    return true;
  }), [templates, nameFilter, appliedTemplateType, appliedTxnType]);

  const today = todayLocal();
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

  function handleExport() {
    setExcelBusy(true);
    try {
      const headers = ['Template Name', 'Type', 'TXN Type', 'Interval', 'Previous Date', 'Next Date', 'Amount'];
      const rows = filteredTemplates.map(t => [
        t.name,
        'Scheduled',
        TXN_TYPE_LABELS[t.template_type] ?? t.template_type,
        INTERVAL_LABELS[t.recurrence] ?? t.recurrence,
        fmtShortDate(t.last_run_at),
        fmtShortDate(t.next_run_date),
        '0.00',
      ]);
      downloadAsExcel(headers, rows, 'recurring-transactions');
    } finally {
      setExcelBusy(false);
    }
  }

  function handlePrint() {
    const rows = filteredTemplates.map(t => `
      <tr>
        <td>${t.name}</td>
        <td>Scheduled</td>
        <td>${TXN_TYPE_LABELS[t.template_type] ?? t.template_type}</td>
        <td>${INTERVAL_LABELS[t.recurrence] ?? t.recurrence}</td>
        <td>${fmtShortDate(t.last_run_at)}</td>
        <td>${fmtShortDate(t.next_run_date)}</td>
        <td>—</td>
        <td style="text-align:right">0.00</td>
      </tr>`).join('');
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>Recurring Transactions</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 11px; margin: 24px; }
        h2 { margin-bottom: 4px; }
        p { color: #666; font-size: 10px; margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #f0f0f0; text-align: left; padding: 5px 7px; border-bottom: 2px solid #ccc; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
        td { padding: 4px 7px; border-bottom: 1px solid #e5e5e5; }
        tr:last-child td { border-bottom: none; }
      </style></head><body>
      <h2>Recurring Transactions</h2>
      <p>Generated ${new Date().toLocaleDateString()}</p>
      <table>
        <thead><tr><th>Template Name</th><th>Type</th><th>TXN Type</th><th>Interval</th><th>Previous Date</th><th>Next Date</th><th>Customer/Vendor</th><th>Amount</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <script>window.onload = function(){ window.print(); }</script>
    </body></html>`);
    win.document.close();
  }

  function applyFilter() {
    setAppliedTemplateType(pendingTemplateType);
    setAppliedTxnType(pendingTxnType);
    setShowFilterModal(false);
  }

  function resetFilter() {
    setPendingTemplateType('');
    setPendingTxnType('');
    setAppliedTemplateType('');
    setAppliedTxnType('');
    setNameFilter('');
  }

  const activeFilterCount = (appliedTemplateType ? 1 : 0) + (appliedTxnType ? 1 : 0);

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
    setDeleteErr(null);
    try {
      await api.delete(`/businesses/${bizId}/recurring-templates/${id}`);
      reload();
    } catch (e: unknown) {
      setDeleteErr(pickErr(e));
    }
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    if (!bizId) return;
    setFormErr(null);

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]!;
      const d = parseFloat(l.debit) || 0;
      const c = parseFloat(l.credit) || 0;
      if (!l.account_id) { setFormErr(`Line ${i + 1}: select an account.`); return; }
      if (d > 0 && c > 0) { setFormErr(`Line ${i + 1}: only one of debit or credit may be > 0.`); return; }
      if (d === 0 && c === 0) { setFormErr(`Line ${i + 1}: enter a debit or credit amount.`); return; }
    }
    if (!balanced) { setFormErr('Total debit must equal total credit.'); return; }

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
        template_type: form.template_type,
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Recurring Transactions</h1>
      </div>

      {/* Filter + icon toolbar */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Input
            placeholder="Filter by Name"
            value={nameFilter}
            onChange={e => setNameFilter(e.target.value)}
            className="w-52"
          />
          <Button
            variant="outline"
            onClick={() => { setPendingTemplateType(appliedTemplateType); setPendingTxnType(appliedTxnType); setShowFilterModal(true); }}
          >
            Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </Button>
          {(nameFilter || activeFilterCount > 0) && (
            <button className="text-xs text-muted-foreground hover:text-foreground underline" onClick={resetFilter}>
              Clear
            </button>
          )}
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

      <Card>
        <CardHeader>
          <CardTitle>Due now ({due.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {due.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing due today.</p>
          ) : (
            <ul className="divide-y text-sm">
              {due.map((t) => (
                <li key={t.id} className="flex justify-between py-2">
                  <span>{t.name}</span>
                  <span className="text-muted-foreground">
                    <span className="capitalize">{t.recurrence}</span> — next <span className="font-mono">{fmtDate(t.next_run_date)}</span>
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

      {deleteErr && <p className="text-sm text-destructive">{deleteErr}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>
              All templates{filteredTemplates.length !== templates.length ? ` (${filteredTemplates.length} of ${templates.length})` : ''}
            </span>
            <Button
              size="sm"
              onClick={() => { setShowForm((s) => !s); if (showForm) resetForm(); }}
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
                  <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
                </div>
                <div>
                  <Label>Transaction type</Label>
                  <select
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={form.template_type}
                    onChange={(e) => setForm((f) => ({ ...f, template_type: e.target.value as TemplateType }))}
                    required
                  >
                    {TXN_TYPE_OPTIONS.map(o => (
                      <option key={o.value} value={o.value} disabled={o.disabled} title={o.title}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>Recurrence</Label>
                  <select
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={form.recurrence}
                    onChange={(e) => setForm((f) => ({ ...f, recurrence: e.target.value as Recurrence }))}
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
                  <DateInput value={form.next_run_date} onChange={(e) => setForm((f) => ({ ...f, next_run_date: e.target.value }))} required />
                </div>
                <div>
                  <Label>End date (optional)</Label>
                  <DateInput value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} />
                </div>
                <div>
                  <Label>Reference</Label>
                  <Input value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} />
                </div>
                <div className="col-span-2">
                  <Label>Memo</Label>
                  <Input value={form.memo} onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))} />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Lines</Label>
                  <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, blankLine()])}>+ Add line</Button>
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
                        {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                      </select>
                    </div>
                    <div className="col-span-2">
                      <Label className="sr-only">Debit</Label>
                      <Input type="number" step="0.0001" min="0" value={l.debit} onChange={(e) => updateLine(i, { debit: e.target.value, credit: '0.00' })} />
                    </div>
                    <div className="col-span-2">
                      <Label className="sr-only">Credit</Label>
                      <Input type="number" step="0.0001" min="0" value={l.credit} onChange={(e) => updateLine(i, { credit: e.target.value, debit: '0.00' })} />
                    </div>
                    <div className="col-span-3">
                      <Label className="sr-only">Memo</Label>
                      <Input value={l.memo} onChange={(e) => updateLine(i, { memo: e.target.value })} placeholder="Line memo" />
                    </div>
                    <div className="col-span-1">
                      <Button type="button" variant="ghost" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} disabled={lines.length <= 2}>×</Button>
                    </div>
                  </div>
                ))}
                <div className="flex justify-end gap-8 pt-3 border-t font-mono text-sm">
                  <div>Total Debit: {fmtMoney(totalD)}</div>
                  <div>Total Credit: {fmtMoney(totalC)}</div>
                  <div className={balanced ? 'text-green-600' : 'text-destructive'}>{balanced ? 'BALANCED' : 'UNBALANCED'}</div>
                </div>
              </div>

              {formErr && <p className="text-sm text-destructive">{formErr}</p>}
              <div className="flex gap-2">
                <Button type="submit" disabled={busy || !balanced}>{busy ? 'Saving…' : 'Create template'}</Button>
                <Button type="button" variant="outline" onClick={() => { setShowForm(false); resetForm(); }}>Cancel</Button>
              </div>
            </form>
          )}

          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="text-left p-3 font-medium text-xs uppercase tracking-wide">Template Name</th>
                <th className="text-left p-3 font-medium text-xs uppercase tracking-wide">Type</th>
                <th className="text-left p-3 font-medium text-xs uppercase tracking-wide">TXN Type</th>
                <th className="text-left p-3 font-medium text-xs uppercase tracking-wide">Interval</th>
                <th className="text-left p-3 font-medium text-xs uppercase tracking-wide">Previous Date</th>
                <th className="text-left p-3 font-medium text-xs uppercase tracking-wide">Next Date</th>
                <th className="text-left p-3 font-medium text-xs uppercase tracking-wide">Customer/Vendor</th>
                <th className="text-right p-3 font-medium text-xs uppercase tracking-wide">Amount</th>
                <th className="text-right p-3 font-medium text-xs uppercase tracking-wide">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredTemplates.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-4 text-center text-muted-foreground">
                    {templates.length === 0 ? 'No templates yet.' : 'No templates match the filter.'}
                  </td>
                </tr>
              ) : (
                filteredTemplates.map((t) => (
                  <tr key={t.id} className="border-b last:border-b-0 hover:bg-muted/30">
                    <td className="p-3 font-medium">{t.name}</td>
                    <td className="p-3 text-muted-foreground">Scheduled</td>
                    <td className="p-3">{TXN_TYPE_LABELS[t.template_type] ?? t.template_type}</td>
                    <td className="p-3">{INTERVAL_LABELS[t.recurrence] ?? t.recurrence}</td>
                    <td className="p-3 font-mono whitespace-nowrap">{fmtShortDate(t.last_run_at)}</td>
                    <td className="p-3 font-mono whitespace-nowrap">{fmtShortDate(t.next_run_date)}</td>
                    <td className="p-3 text-muted-foreground">—</td>
                    <td className="p-3 text-right font-mono">0.00</td>
                    <td className="p-3 text-right">
                      <Button size="sm" variant="ghost" className="text-primary hover:text-primary h-auto p-0 font-normal" onClick={() => deleteTemplate(t.id)}>
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

      {/* Filter modal */}
      {showFilterModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-background rounded-lg shadow-xl w-full max-w-sm mx-4">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h2 className="text-lg font-semibold">Recurring Transactions</h2>
              <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setShowFilterModal(false)}>✕</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <Label>Template Type</Label>
                <select
                  className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={pendingTemplateType}
                  onChange={e => setPendingTemplateType(e.target.value)}
                >
                  <option value="">All</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>
              <div>
                <Label>Transaction Type</Label>
                <select
                  className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={pendingTxnType}
                  onChange={e => setPendingTxnType(e.target.value)}
                >
                  <option value="">All</option>
                  {TXN_TYPE_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="border-t px-6 py-4 flex items-center justify-between gap-2">
              <Button variant="outline" onClick={() => { setPendingTemplateType(''); setPendingTxnType(''); }}>Reset</Button>
              <Button onClick={applyFilter}>Apply</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
