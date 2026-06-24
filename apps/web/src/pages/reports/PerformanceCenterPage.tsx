import { useEffect, useState } from 'react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmtMoney } from '@/lib/money';

type TrendPoint = { month: string; amount: string };

type PerformanceReport = {
  revenue_trend: TrendPoint[];
  expense_trend: TrendPoint[];
  net_income_trend: TrendPoint[];
};

function Sparkline({ data, color }: { data: TrendPoint[]; color: string }) {
  if (data.length < 2) {
    return <svg width="200" height="60" className="block" />;
  }
  const values = data.map(d => Number(d.amount));
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * 200;
      const y = 60 - ((v - min) / range) * 60;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width="200" height="60" className="block">
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" />
    </svg>
  );
}

function TrendCard({ title, color, data }: { title: string; color: string; data: TrendPoint[] }) {
  const allZero = data.length === 0 || data.every(d => Number(d.amount) === 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Sparkline data={data} color={color} />
        <div className="w-full overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="border-b text-muted-foreground">
            <tr>
              <th className="text-left py-1">Month</th>
              <th className="text-right py-1">Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td className="py-1" colSpan={2}>—</td>
              </tr>
            ) : (
              data.map(d => (
                <tr key={d.month} className="border-b last:border-b-0">
                  <td className="py-1">{d.month}</td>
                  <td className="py-1 text-right">{allZero ? '—' : fmtMoney(d.amount)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
      </CardContent>
    </Card>
  );
}

export default function PerformanceCenterPage() {
  const [bizId] = useActiveBusinessId();
  const [report, setReport] = useState<PerformanceReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!bizId) return;
    setLoading(true);
    setErr(null);
    api
      .get<PerformanceReport>(`/businesses/${bizId}/performance-report`)
      .then(r => setReport(r.data))
      .catch((e: unknown) => {
        const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)
          ?.response?.data?.error?.message;
        setErr(msg ?? 'Failed to load report');
        setReport(null);
      })
      .finally(() => setLoading(false));
  }, [bizId]);

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Performance Center</h1>
        {loading && <span className="text-sm text-muted-foreground">Loading…</span>}
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      {report && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <TrendCard title="Revenue" color="#10b981" data={report.revenue_trend} />
          <TrendCard title="Expense" color="#ef4444" data={report.expense_trend} />
          <TrendCard title="Net Income" color="#3b82f6" data={report.net_income_trend} />
        </div>
      )}
    </div>
  );
}
