import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

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

type ListResponse = { employees: Employee[] };

type RevealState = { id: string; ssn: string | null };

function maskSSN(lastFour: string | null): string {
  if (!lastFour) return '—';
  return `***-**-${lastFour}`;
}

function fmtRate(cents: string): string {
  const dollars = Number(cents) / 100;
  return `$${dollars.toFixed(2)}`;
}

export default function EmployeeListPage() {
  const [bizId] = useActiveBusinessId();
  const { user } = useAuth();
  const isFirmAdmin = user?.role === 'firm_admin';
  const [items, setItems] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState<RevealState | null>(null);

  async function reload() {
    if (!bizId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api.get<ListResponse>(`/businesses/${bizId}/employees`);
      setItems(r.data.employees);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setError(msg ?? 'Failed to load employees');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bizId]);

  // Auto-hide revealed SSN after 30s
  useEffect(() => {
    if (!reveal) return;
    const t = window.setTimeout(() => setReveal(null), 30_000);
    return () => window.clearTimeout(t);
  }, [reveal]);

  async function handleReveal(emp: Employee) {
    if (!bizId) return;
    try {
      const r = await api.get<{ ssn: string | null }>(`/businesses/${bizId}/employees/${emp.id}/ssn-reveal`);
      setReveal({ id: emp.id, ssn: r.data.ssn ?? null });
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setError(msg ?? 'Failed to reveal SSN');
    }
  }

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Employees</h1>
        {isFirmAdmin && (
          <Button asChild>
            <Link to="/payroll/employees/new">Add employee</Link>
          </Button>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardContent className="p-0">
          {loading && items.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : items.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No employees yet.{isFirmAdmin && ' Add one to get started.'}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="text-left p-3">Name</th>
                  <th className="text-left p-3">Hire Date</th>
                  <th className="text-right p-3">Pay Rate</th>
                  <th className="text-left p-3">Frequency</th>
                  <th className="text-left p-3">SSN</th>
                  <th className="text-left p-3">Status</th>
                  <th className="text-right p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((emp) => {
                  const showRevealed = reveal && reveal.id === emp.id;
                  return (
                    <tr key={emp.id} className="border-b last:border-b-0 align-top">
                      <td className="p-3">{emp.full_name}</td>
                      <td className="p-3">{emp.hire_date}</td>
                      <td className="p-3 text-right font-mono">{fmtRate(emp.default_pay_rate_cents)}</td>
                      <td className="p-3">{emp.default_pay_frequency}</td>
                      <td className="p-3 font-mono">
                        {showRevealed ? (
                          <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-900">
                            {reveal!.ssn ?? '—'}
                            <span className="ml-2 text-xs text-amber-700">(hides in 30s)</span>
                          </span>
                        ) : (
                          maskSSN(emp.ssn_last_four)
                        )}
                      </td>
                      <td className="p-3">
                        <span
                          className={
                            emp.is_active
                              ? 'inline-flex items-center rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800'
                              : 'inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'
                          }
                        >
                          {emp.is_active ? 'active' : 'inactive'}
                        </span>
                      </td>
                      <td className="p-3 text-right space-x-2">
                        <Link className="text-primary underline" to={`/payroll/employees/${emp.id}`}>
                          View
                        </Link>
                        {isFirmAdmin && emp.ssn_last_four && (
                          showRevealed ? (
                            <Button size="sm" variant="outline" onClick={() => setReveal(null)}>Hide</Button>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => handleReveal(emp)}>Reveal SSN</Button>
                          )
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
