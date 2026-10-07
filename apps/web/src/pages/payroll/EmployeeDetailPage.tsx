import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { useAuth } from '@/auth/useAuth';
import { hasMinRole } from '@accounting/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { DateInput } from '@/components/ui/date-input';
import { Label } from '@/components/ui/label';
import { AppSelect } from '../../components/ui/select';
import { pickErr } from '@/lib/apiErrors';
import { fmtLongDate } from '@/lib/dates';
import { humanizeCode } from '@/lib/labels';

type PayFrequency = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';
type W4FilingStatus = 'single' | 'married_jointly' | 'married_separately' | 'head_of_household';

type Employee = {
  id: string;
  business_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  hire_date: string;
  termination_date: string | null;
  ssn_last_four: string | null;
  default_pay_rate_cents: string;
  default_pay_frequency: PayFrequency;
  w4_filing_status: W4FilingStatus | null;
  is_active: boolean;
};

function maskSSN(lastFour: string | null): string {
  if (!lastFour) return '—';
  return `***-**-${lastFour}`;
}

function fmtRate(cents: string): string {
  const dollars = Number(cents) / 100;
  return `$${dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const { user } = useAuth();
  const isFirmAdmin = user?.role === 'firm_admin';
  const [data, setData] = useState<Employee | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [reveal, setReveal] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const canEdit = user?.role !== undefined && hasMinRole(user.role, 'accountant');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    full_name: '', email: '', phone: '', pay_rate: '', default_pay_frequency: 'biweekly' as PayFrequency,
    w4_filing_status: '' as W4FilingStatus | '', termination_date: '', is_active: true,
  });

  function startEdit(employee: Employee) {
    setForm({
      full_name: employee.full_name,
      email: employee.email ?? '',
      phone: employee.phone ?? '',
      pay_rate: (Number(employee.default_pay_rate_cents) / 100).toFixed(2),
      default_pay_frequency: employee.default_pay_frequency,
      w4_filing_status: employee.w4_filing_status ?? '',
      termination_date: employee.termination_date ?? '',
      is_active: employee.is_active,
    });
    setActionErr(null);
    setEditing(true);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!bizId || !id) return;
    setSaving(true); setActionErr(null);
    try {
      await api.patch(`/businesses/${bizId}/employees/${id}`, {
        full_name: form.full_name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        default_pay_rate_cents: Math.round((Number(form.pay_rate) || 0) * 100),
        default_pay_frequency: form.default_pay_frequency,
        w4_filing_status: form.w4_filing_status || null,
        termination_date: form.termination_date || null,
        is_active: form.is_active,
      });
      setEditing(false);
      await reload();
    } catch (err: unknown) {
      setActionErr(pickErr(err));
    } finally {
      setSaving(false);
    }
  }

  const reload = useCallback(async () => {
    if (!bizId || !id) return;
    setLoadErr(null);
    try {
      const r = await api.get<Employee>(`/businesses/${bizId}/employees/${id}`);
      setData(r.data);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setLoadErr(msg ?? 'Failed to load employee');
    }
  }, [bizId, id]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Auto-hide revealed SSN after 30s
  useEffect(() => {
    if (reveal === null) return;
    const t = window.setTimeout(() => setReveal(null), 30_000);
    return () => window.clearTimeout(t);
  }, [reveal]);

  async function handleReveal() {
    if (!bizId || !id) return;
    setActionErr(null);
    try {
      const r = await api.get<{ ssn: string | null }>(`/businesses/${bizId}/employees/${id}/ssn-reveal`);
      setReveal(r.data.ssn ?? '—');
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setActionErr(msg ?? 'Failed to reveal SSN');
    }
  }

  async function handleDelete() {
    if (!bizId || !id || !data) return;
    if (!window.confirm(`Delete employee ${data.full_name}? This is a soft delete.`)) return;
    setActionErr(null);
    setDeleting(true);
    try {
      await api.delete(`/businesses/${bizId}/employees/${id}`);
      nav('/payroll/employees');
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setActionErr(msg ?? 'Failed to delete employee');
      setDeleting(false);
    }
  }

  if (!bizId) return <div>Pick a business.</div>;
  if (loadErr) return <div className="text-sm text-destructive">{loadErr}</div>;
  if (!data) return <div>Loading…</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{data.full_name}</h1>
          <p className="text-sm text-muted-foreground">Hired {fmtLongDate(data.hire_date)}</p>
        </div>
        <span
          className={
            data.is_active
              ? 'inline-flex items-center rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800'
              : 'inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'
          }
        >
          {data.is_active ? 'Active' : 'Inactive'}
        </span>
      </div>

      {actionErr && <p className="text-sm text-destructive">{actionErr}</p>}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Details</CardTitle>
          {canEdit && !editing && <Button size="sm" variant="outline" onClick={() => startEdit(data)}>Edit</Button>}
        </CardHeader>
        {editing ? (
          <CardContent>
            <form className="grid grid-cols-1 gap-3 md:grid-cols-2" onSubmit={saveEdit}>
              <div>
                <Label>Full name</Label>
                <Input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} required />
              </div>
              <div>
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
              <div>
                <Label>Pay rate (per hour)</Label>
                <MoneyInput className="text-right font-mono" value={form.pay_rate} onChange={e => setForm(f => ({ ...f, pay_rate: e.target.value }))} />
              </div>
              <div>
                <Label>Pay frequency</Label>
                <AppSelect
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={form.default_pay_frequency}
                  onChange={e => setForm(f => ({ ...f, default_pay_frequency: e.target.value as PayFrequency }))}
                >
                  {(['weekly', 'biweekly', 'semimonthly', 'monthly'] as const).map(v => <option key={v} value={v}>{humanizeCode(v)}</option>)}
                </AppSelect>
              </div>
              <div>
                <Label>W-4 filing status</Label>
                <AppSelect
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={form.w4_filing_status}
                  onChange={e => setForm(f => ({ ...f, w4_filing_status: e.target.value as W4FilingStatus | '' }))}
                >
                  <option value="">Not set</option>
                  {(['single', 'married_jointly', 'married_separately', 'head_of_household'] as const).map(v => <option key={v} value={v}>{humanizeCode(v)}</option>)}
                </AppSelect>
              </div>
              <div>
                <Label>Termination date</Label>
                <DateInput value={form.termination_date} onChange={e => setForm(f => ({ ...f, termination_date: e.target.value }))} />
              </div>
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                Active (included when payroll is run)
              </label>
              <div className="flex gap-2 md:col-span-2">
                <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
                <Button type="button" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        ) : (
          <CardContent className="grid grid-cols-2 gap-2 text-sm">
            <div>Email: {data.email ?? '—'}</div>
            <div>Phone: {data.phone ?? '—'}</div>
            <div>Hire date: {fmtLongDate(data.hire_date)}</div>
            <div>Termination date: {data.termination_date ? fmtLongDate(data.termination_date) : '—'}</div>
            <div>Pay rate: <span className="font-mono">{fmtRate(data.default_pay_rate_cents)}</span> an hour</div>
            <div>Pay frequency: {humanizeCode(data.default_pay_frequency)}</div>
            <div className="col-span-2">W-4 filing status: {data.w4_filing_status ? humanizeCode(data.w4_filing_status) : '—'}</div>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>SSN</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="font-mono text-sm">
            {reveal !== null ? (
              <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-900">
                {reveal}
                <span className="ml-2 text-xs text-amber-700">(hides in 30s)</span>
              </span>
            ) : (
              maskSSN(data.ssn_last_four)
            )}
          </div>
          {isFirmAdmin && data.ssn_last_four && (
            <div>
              {reveal !== null ? (
                <Button size="sm" variant="outline" onClick={() => setReveal(null)}>Hide</Button>
              ) : (
                <Button size="sm" variant="outline" onClick={handleReveal}>Reveal SSN</Button>
              )}
            </div>
          )}
          {!data.ssn_last_four && (
            <p className="text-xs text-muted-foreground">No SSN on file.</p>
          )}
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button variant="outline" onClick={() => nav('/payroll/employees')}>
          Back to list
        </Button>
        {isFirmAdmin && (
          <Button variant="ghost" onClick={handleDelete} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete employee'}
          </Button>
        )}
      </div>
    </div>
  );
}
