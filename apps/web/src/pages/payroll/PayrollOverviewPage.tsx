import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { useActiveBusinessId } from '@/lib/business';
import { api } from '@/lib/apiClient';

type Overview = {
  next_pay_date: string | null;
  total_liabilities_outstanding: string;
  last_pay_run_total: string;
  employee_count: number;
};

export default function PayrollOverviewPage() {
  const [bizId] = useActiveBusinessId();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bizId) return;
    setData(null);
    setError(null);
    api
      .get<Overview>(`/businesses/${bizId}/payroll-overview`)
      .then((r) => setData(r.data))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'load failed'));
  }, [bizId]);

  if (error) return <div className="text-destructive">{error}</div>;
  if (!data) return <div className="text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Payroll Overview</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Next Pay Date</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">
            {data.next_pay_date ?? '—'}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Total Liabilities Outstanding</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold font-mono">
            ${data.total_liabilities_outstanding}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Last Pay Run Total</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold font-mono">
            ${data.last_pay_run_total}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Employees</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">{data.employee_count}</CardContent>
        </Card>
      </div>
    </div>
  );
}
