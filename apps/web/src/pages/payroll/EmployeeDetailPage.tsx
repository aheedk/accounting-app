import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

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
  return `$${dollars.toFixed(2)}`;
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
          <p className="text-sm text-muted-foreground">Hired {data.hire_date}</p>
        </div>
        <span
          className={
            data.is_active
              ? 'inline-flex items-center rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800'
              : 'inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'
          }
        >
          {data.is_active ? 'active' : 'inactive'}
        </span>
      </div>

      {actionErr && <p className="text-sm text-destructive">{actionErr}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 text-sm">
          <div>Email: {data.email ?? '—'}</div>
          <div>Phone: {data.phone ?? '—'}</div>
          <div>Hire date: {data.hire_date}</div>
          <div>Termination date: {data.termination_date ?? '—'}</div>
          <div>Pay rate: <span className="font-mono">{fmtRate(data.default_pay_rate_cents)}</span></div>
          <div>Pay frequency: {data.default_pay_frequency}</div>
          <div className="col-span-2">W-4 filing status: {data.w4_filing_status ?? '—'}</div>
        </CardContent>
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
