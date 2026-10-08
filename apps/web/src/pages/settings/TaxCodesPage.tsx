import { useEffect, useState } from 'react';
import { DateInput } from '@/components/ui/date-input';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { useEffectiveRole } from '@/lib/roleAccess';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FileDown, Printer } from 'lucide-react';
import { downloadAsExcel } from '@/lib/download';
import { AppSelect } from '../../components/ui/select';
import { useAddAccount } from '@/components/addNew/useAddAccount';
import { printReport } from '@/lib/reportExport';
import { todayLocal } from '@/lib/dates';

type TaxCode = { id: string; code: string; name: string; tax_payable_account_id: string; current_rate: string | null; is_active: boolean };

/** A stored rate (0.0875) as the percent a person reads (8.75). */
const ratePercent = (rate: string | null) => (rate ? String(parseFloat((parseFloat(rate) * 100).toFixed(4))) : '');
/** And back, without the stray digits dividing by 100 leaves behind. */
const rateFromPercent = (percent: string) => Number(((parseFloat(percent) || 0) / 100).toFixed(6));
const pickErr = (e: unknown) =>
  (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message ?? 'Failed';
type Account = { id: string; code: string; name: string; account_type: string; is_system: boolean; is_active: boolean };

function statusBadge(active: boolean) {
  const base = 'inline-flex rounded-full px-2 py-0.5 text-xs font-medium';
  return active
    ? <span className={`${base} bg-emerald-100 text-emerald-800`}>Active</span>
    : <span className={`${base} bg-muted text-muted-foreground`}>Inactive</span>;
}

export default function TaxCodesPage() {
  const [bizId] = useActiveBusinessId();
  // The API takes these changes from a firm admin only.
  const isFirmAdmin = useEffectiveRole() === 'firm_admin';
  const [items, setItems] = useState<TaxCode[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const addAccount = useAddAccount(accounts, account => setAccounts(prev => [...prev, account]));
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', tax_payable_account_id: '', rate: '8.75', effective_from: '2026-01-01' });
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<TaxCode | null>(null);
  const [editForm, setEditForm] = useState({ name: '', tax_payable_account_id: '', is_active: true, rate: '', effective_from: todayLocal() });
  const [editErr, setEditErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [excelBusy, setExcelBusy] = useState(false);

  async function reload() {
    if (!bizId) return;
    const r = await api.get(`/businesses/${bizId}/tax-codes`);
    setItems(r.data.tax_codes);
    const a = await api.get(`/businesses/${bizId}/coa`);
    setAccounts(a.data.accounts.filter((x: Account) => x.account_type === 'liability' && x.is_active));
  }
  useEffect(() => { reload(); }, [bizId]);

  async function create(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    try {
      await api.post(`/businesses/${bizId}/tax-codes`, {
        code: form.code, name: form.name, tax_payable_account_id: form.tax_payable_account_id,
        initial_rate: { rate: rateFromPercent(form.rate), effective_from: form.effective_from, effective_to: null },
      });
      setShow(false); setForm({ code: '', name: '', tax_payable_account_id: '', rate: '8.75', effective_from: '2026-01-01' });
      await reload();
    } catch (e: unknown) {
      setErr(pickErr(e));
    }
  }

  function startEdit(c: TaxCode) {
    setEditing(c);
    setEditForm({ name: c.name, tax_payable_account_id: c.tax_payable_account_id, is_active: c.is_active, rate: ratePercent(c.current_rate), effective_from: todayLocal() });
    setEditErr(null);
    setShow(false);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!bizId || !editing) return;
    setSaving(true); setEditErr(null);
    try {
      // A rate is only sent when it changed: it starts on the date given and earlier dates keep the old one.
      const rateChanged = editForm.rate !== '' && editForm.rate !== ratePercent(editing.current_rate);
      await api.patch(`/businesses/${bizId}/tax-codes/${editing.id}`, {
        name: editForm.name.trim(),
        tax_payable_account_id: editForm.tax_payable_account_id,
        is_active: editForm.is_active,
        ...(rateChanged ? { new_rate: { rate: rateFromPercent(editForm.rate), effective_from: editForm.effective_from } } : {}),
      });
      setEditing(null);
      await reload();
    } catch (e: unknown) {
      setEditErr(pickErr(e));
    } finally {
      setSaving(false);
    }
  }

  if (!bizId) return <div>Pick a business.</div>;

  const dlHeaders = ['Code', 'Name', 'Current Rate', 'Active'];
  const dlRows = () => items.map(c => [c.code, c.name, c.current_rate ? `${ratePercent(c.current_rate)}%` : '—', c.is_active ? 'Yes' : 'No']);

  function handleExport() {
    setExcelBusy(true);
    try { downloadAsExcel(dlHeaders, dlRows(), 'tax-codes', { title: 'Tax Codes' }); } finally { setExcelBusy(false); }
  }

  function handlePrint() {
    printReport({ title: 'Tax Codes', headers: dlHeaders, rows: dlRows() });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Tax Codes</h1>
        <div className="flex items-center gap-2">
          <div className="relative group">
            <button className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50" onClick={handleExport} disabled={excelBusy} aria-label="Export to Excel">
              <FileDown className="h-4 w-4" />
            </button>
            <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">Export to Excel</div>
          </div>
          <div className="relative group">
            <button className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground" onClick={handlePrint} aria-label="Print">
              <Printer className="h-4 w-4" />
            </button>
            <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">Print</div>
          </div>
          {isFirmAdmin && <Button onClick={() => { setShow(s => !s); setEditing(null); }}>{show ? 'Cancel' : 'New tax code'}</Button>}
        </div>
      </div>
      {show && (
        <Card><CardHeader><CardTitle>Create</CardTitle></CardHeader>
          <CardContent>
            <form className="grid grid-cols-3 gap-3 items-end" onSubmit={create}>
              <div><Label>Code</Label><Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} required /></div>
              <div><Label>Name</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required /></div>
              <div><Label>Payable account</Label>
                <AppSelect className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.tax_payable_account_id} onChange={e => setForm(f => ({ ...f, tax_payable_account_id: e.target.value }))} required onAddNew={() => addAccount.open({ onPick: id => setForm(f => ({ ...f, tax_payable_account_id: id })) })} addNewLabel="Add new account">
                  <option value="">Select…</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                </AppSelect>
              </div>
              <div><Label>Rate (%)</Label><Input type="number" step="0.0001" min="0" max="100" value={form.rate} onChange={e => setForm(f => ({ ...f, rate: e.target.value }))} required /></div>
              <div><Label>Effective from</Label><DateInput value={form.effective_from} onChange={e => setForm(f => ({ ...f, effective_from: e.target.value }))} required /></div>
              <Button type="submit">Create</Button>
              {err && <p className="text-sm text-destructive col-span-3">{err}</p>}
            </form>
          </CardContent>
        </Card>
      )}
      {editing && (
        <Card><CardHeader><CardTitle>Edit {editing.code}</CardTitle></CardHeader>
          <CardContent>
            <form className="grid grid-cols-3 gap-3 items-end" onSubmit={saveEdit}>
              <div><Label>Name</Label><Input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} required /></div>
              <div><Label>Payable account</Label>
                <AppSelect className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={editForm.tax_payable_account_id} onChange={e => setEditForm(f => ({ ...f, tax_payable_account_id: e.target.value }))} required onAddNew={() => addAccount.open({ onPick: id => setEditForm(f => ({ ...f, tax_payable_account_id: id })) })} addNewLabel="Add new account">
                  <option value="">Select…</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                </AppSelect>
              </div>
              <label className="flex items-center gap-2 pb-2 text-sm">
                <input type="checkbox" checked={editForm.is_active} onChange={e => setEditForm(f => ({ ...f, is_active: e.target.checked }))} />
                Active
              </label>
              <div><Label>Rate (%)</Label><Input type="number" step="0.0001" min="0" max="100" value={editForm.rate} onChange={e => setEditForm(f => ({ ...f, rate: e.target.value }))} required /></div>
              <div><Label>New rate applies from</Label><DateInput value={editForm.effective_from} onChange={e => setEditForm(f => ({ ...f, effective_from: e.target.value }))} required /></div>
              <div className="flex gap-2">
                <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
                <Button type="button" variant="ghost" onClick={() => setEditing(null)} disabled={saving}>Cancel</Button>
              </div>
              <p className="col-span-3 text-xs text-muted-foreground">Changing the rate does not change invoices already entered. They keep the rate that applied on their date.</p>
              {editErr && <p className="text-sm text-destructive col-span-3">{editErr}</p>}
            </form>
          </CardContent>
        </Card>
      )}
      <Card><CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40"><tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground"><th className="text-left p-3">Code</th><th className="text-left p-3">Name</th><th className="text-right p-3">Current rate</th><th className="text-left p-3">Status</th><th className="text-right p-3">Action</th></tr></thead>
          <tbody>{items.length === 0 && (<tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No tax codes yet.</td></tr>)}{items.map(c => (<tr key={c.id} className="border-b last:border-b-0 hover:bg-muted/30">
            <td className="p-3 font-mono">{c.code}</td>
            <td className="p-3">{c.name}</td>
            <td className="p-3 text-right font-mono">{c.current_rate ? `${ratePercent(c.current_rate)}%` : '—'}</td>
            <td className="p-3">{statusBadge(c.is_active)}</td>
            <td className="p-3 text-right"><Button size="sm" variant="ghost" className="h-auto p-0 font-normal text-primary hover:text-primary" onClick={() => startEdit(c)} disabled={!isFirmAdmin} title={isFirmAdmin ? undefined : 'Only a firm admin can change a tax code'}>Edit</Button></td>
          </tr>))}</tbody>
        </table>
      </CardContent></Card>
      {addAccount.drawer}
    </div>
  );
}
