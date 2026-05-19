import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/DataTable';

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
  return `$${dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtShortDate(iso: string) {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
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

  const columns: Column<Employee>[] = [
    {
      key: 'full_name',
      header: 'Name',
      sortable: true,
      sortValue: r => r.full_name,
      render: r => <Link className="font-medium hover:underline" to={`/payroll/employees/${r.id}`}>{r.full_name}</Link>,
    },
    {
      key: 'hire_date',
      header: 'Hire date',
      sortable: true,
      sortValue: r => Date.parse(r.hire_date) || 0,
      render: r => <span className="whitespace-nowrap">{fmtShortDate(r.hire_date)}</span>,
    },
    {
      key: 'pay_rate',
      header: 'Pay rate',
      align: 'right',
      sortable: true,
      sortValue: r => Number(r.default_pay_rate_cents),
      render: r => <span className="font-mono">{fmtRate(r.default_pay_rate_cents)}</span>,
    },
    {
      key: 'frequency',
      header: 'Frequency',
      sortable: true,
      sortValue: r => r.default_pay_frequency,
      render: r => <span className="capitalize">{r.default_pay_frequency}</span>,
    },
    {
      key: 'ssn',
      header: 'SSN',
      render: r => {
        const showRevealed = reveal && reveal.id === r.id;
        return (
          <span className="font-mono">
            {showRevealed ? (
              <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-900">
                {reveal.ssn ?? '—'}
                <span className="ml-2 text-xs text-amber-700">(hides in 30s)</span>
              </span>
            ) : (
              maskSSN(r.ssn_last_four)
            )}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      sortValue: r => r.is_active ? 1 : 0,
      render: r => (
        <span
          className={
            r.is_active
              ? 'inline-flex items-center rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800'
              : 'inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'
          }
        >
          {r.is_active ? 'active' : 'inactive'}
        </span>
      ),
    },
  ];

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
          ) : (
            <DataTable
              rows={items}
              getRowId={r => r.id}
              columns={columns}
              defaultSortKey="full_name"
              defaultSortDir="asc"
              actions={r => {
                const showRevealed = reveal && reveal.id === r.id;
                return (
                  <span className="inline-flex items-center gap-2">
                    <Link className="text-primary underline" to={`/payroll/employees/${r.id}`}>
                      View
                    </Link>
                    {isFirmAdmin && r.ssn_last_four && (
                      showRevealed ? (
                        <Button size="sm" variant="outline" onClick={() => setReveal(null)}>Hide</Button>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => handleReveal(r)}>Reveal SSN</Button>
                      )
                    )}
                  </span>
                );
              }}
              emptyMessage={isFirmAdmin ? 'No employees yet. Add one to get started.' : 'No employees yet.'}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
