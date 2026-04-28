import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type PayFrequency = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';
type W4FilingStatus = 'single' | 'married_jointly' | 'married_separately' | 'head_of_household';

type CreateBody = {
  full_name: string;
  email?: string | null;
  phone?: string | null;
  hire_date: string;
  ssn?: string | null;
  default_pay_rate_cents?: number;
  default_pay_frequency?: PayFrequency;
  w4_filing_status?: W4FilingStatus | null;
};

type CreatedEmployee = { id: string };

const PAY_FREQUENCIES: PayFrequency[] = ['weekly', 'biweekly', 'semimonthly', 'monthly'];
const W4_STATUSES: Array<{ value: W4FilingStatus; label: string }> = [
  { value: 'single', label: 'Single' },
  { value: 'married_jointly', label: 'Married filing jointly' },
  { value: 'married_separately', label: 'Married filing separately' },
  { value: 'head_of_household', label: 'Head of household' },
];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function EmployeeNewPage() {
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    phone: '',
    hire_date: today(),
    ssn: '',
    default_pay_rate_cents: '',
    default_pay_frequency: 'biweekly' as PayFrequency,
    w4_filing_status: 'single' as W4FilingStatus,
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const body: CreateBody = {
        full_name: form.full_name.trim(),
        hire_date: form.hire_date,
      };
      const email = form.email.trim();
      if (email !== '') body.email = email;
      const phone = form.phone.trim();
      if (phone !== '') body.phone = phone;
      const ssn = form.ssn.trim();
      if (ssn !== '') body.ssn = ssn;
      const rate = form.default_pay_rate_cents.trim();
      if (rate !== '') {
        const parsed = Number(rate);
        if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
          throw new Error('Pay rate must be a non-negative integer (in cents)');
        }
        body.default_pay_rate_cents = parsed;
      }
      body.default_pay_frequency = form.default_pay_frequency;
      body.w4_filing_status = form.w4_filing_status;

      const r = await api.post<CreatedEmployee>(`/businesses/${bizId}/employees`, body);
      nav(`/payroll/employees/${r.data.id}`);
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message ??
        (e instanceof Error ? e.message : undefined);
      setErr(msg ?? 'Failed to create employee');
    } finally {
      setBusy(false);
    }
  }

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <form className="space-y-6" onSubmit={submit}>
      <h1 className="text-2xl font-semibold">New Employee</h1>
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>Full name</Label>
            <Input
              value={form.full_name}
              onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
              required
            />
          </div>
          <div>
            <Label>Email</Label>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
          </div>
          <div>
            <Label>Phone</Label>
            <Input
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            />
          </div>
          <div>
            <Label>Hire date</Label>
            <Input
              type="date"
              value={form.hire_date}
              onChange={(e) => setForm((f) => ({ ...f, hire_date: e.target.value }))}
              required
            />
          </div>
          <div>
            <Label>SSN (optional)</Label>
            <Input
              value={form.ssn}
              onChange={(e) => setForm((f) => ({ ...f, ssn: e.target.value }))}
              placeholder="123-45-6789"
              autoComplete="off"
            />
          </div>
          <div>
            <Label>Default pay rate (cents)</Label>
            <Input
              type="number"
              step="1"
              min="0"
              value={form.default_pay_rate_cents}
              onChange={(e) => setForm((f) => ({ ...f, default_pay_rate_cents: e.target.value }))}
              placeholder="e.g. 2500 = $25.00"
            />
          </div>
          <div>
            <Label>Pay frequency</Label>
            <select
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={form.default_pay_frequency}
              onChange={(e) => setForm((f) => ({ ...f, default_pay_frequency: e.target.value as PayFrequency }))}
            >
              {PAY_FREQUENCIES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <Label>W-4 filing status</Label>
            <select
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={form.w4_filing_status}
              onChange={(e) => setForm((f) => ({ ...f, w4_filing_status: e.target.value as W4FilingStatus }))}
            >
              {W4_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Create employee'}
        </Button>
        <Button type="button" variant="outline" onClick={() => nav('/payroll/employees')}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
