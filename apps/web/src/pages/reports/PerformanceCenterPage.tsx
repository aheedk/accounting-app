import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
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

type ChartPoint = { month: string; label: string; value: number };

type RangeMonths = 3 | 6 | 12;

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// 'YYYY-MM' → 'Jan', without new Date() (date-only strings parse as UTC and
// roll back a day in negative-offset timezones).
function monthLabel(ym: string): string {
  const idx = Number(ym.slice(5, 7)) - 1;
  return MONTH_ABBR[idx] ?? ym;
}

function monthLongLabel(ym: string): string {
  return `${monthLabel(ym)} ${ym.slice(0, 4)}`;
}

function compactMoney(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(abs % 1_000_000 === 0 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(abs % 1_000 === 0 ? 0 : 1)}k`;
  return `${sign}${abs}`;
}

function ChartTip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ChartPoint }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0]!.payload;
  return (
    <div className="rounded-md border bg-background px-3 py-2 shadow-card">
      <div className="text-xs text-muted-foreground">{monthLongLabel(p.month)}</div>
      <div className="font-mono text-sm">{fmtMoney(p.value)}</div>
    </div>
  );
}

function TrendCard({
  title,
  hint,
  color,
  gradientId,
  data,
  rangeMonths,
}: {
  title: string;
  hint: string;
  color: string;
  gradientId: string;
  data: TrendPoint[];
  rangeMonths: RangeMonths;
}) {
  const points: ChartPoint[] = useMemo(
    () => data.slice(-rangeMonths).map((d) => ({ month: d.month, label: monthLabel(d.month), value: Number(d.amount) })),
    [data, rangeMonths],
  );
  const allZero = points.length === 0 || points.every((p) => p.value === 0);
  const total = points.reduce((s, p) => s + p.value, 0);
  const hasNegative = points.some((p) => p.value < 0);

  // Compare the selected range against the immediately preceding period of
  // equal length, when the 12-month series covers both.
  const priorPoints = data.slice(-rangeMonths * 2, -rangeMonths);
  const priorTotal = priorPoints.reduce((s, p) => s + Number(p.amount), 0);
  const deltaPct = priorPoints.length === rangeMonths && priorTotal !== 0
    ? ((total - priorTotal) / Math.abs(priorTotal)) * 100
    : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-base">
          <span>{title}</span>
          <Link to="/reports/pnl" className="text-xs font-normal text-primary hover:underline">
            View P&amp;L →
          </Link>
        </CardTitle>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <div className="font-mono text-2xl">{allZero ? '—' : fmtMoney(total)}</div>
          <div className="text-xs text-muted-foreground">
            Last {rangeMonths} mo
            {deltaPct !== null && !allZero && (
              <> · {deltaPct >= 0 ? '▲' : '▼'} {Math.abs(deltaPct).toFixed(1)}% vs prior {rangeMonths} mo</>
            )}
          </div>
        </div>

        <div className="h-40 w-full">
          {points.length < 2 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Not enough data to chart.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  minTickGap={16}
                />
                <YAxis
                  width={44}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  tickFormatter={compactMoney}
                />
                <Tooltip content={<ChartTip />} cursor={{ stroke: 'hsl(var(--border))' }} />
                {hasNegative && <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeWidth={1} />}
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={color}
                  strokeWidth={2}
                  fill={`url(#${gradientId})`}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: 'hsl(var(--background))' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="w-full overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b text-muted-foreground">
              <tr>
                <th className="text-left py-1">Month</th>
                <th className="text-right py-1">Amount</th>
              </tr>
            </thead>
            <tbody>
              {points.length === 0 ? (
                <tr>
                  <td className="py-1" colSpan={2}>—</td>
                </tr>
              ) : (
                points.map((p) => (
                  <tr key={p.month} className="border-b last:border-b-0">
                    <td className="py-1">{monthLongLabel(p.month)}</td>
                    <td className="py-1 text-right font-mono">{allZero ? '—' : fmtMoney(p.value)}</td>
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

const RANGES: RangeMonths[] = [3, 6, 12];

export default function PerformanceCenterPage() {
  const [bizId] = useActiveBusinessId();
  const [report, setReport] = useState<PerformanceReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [rangeMonths, setRangeMonths] = useState<RangeMonths>(12);

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
        <div className="flex items-center gap-2">
          {loading && <span className="text-sm text-muted-foreground">Loading…</span>}
          <div className="flex rounded-md border" role="group" aria-label="Date range">
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRangeMonths(r)}
                aria-pressed={rangeMonths === r}
                className={`px-3 py-1.5 text-xs first:rounded-l-md last:rounded-r-md ${
                  rangeMonths === r
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                }`}
              >
                {r}M
              </button>
            ))}
          </div>
        </div>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      {report && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <TrendCard
            title="Revenue"
            hint="Income earned per month, before expenses."
            color="#10b981"
            gradientId="perf-revenue"
            data={report.revenue_trend}
            rangeMonths={rangeMonths}
          />
          <TrendCard
            title="Expense"
            hint="Operating costs recorded per month."
            color="#ef4444"
            gradientId="perf-expense"
            data={report.expense_trend}
            rangeMonths={rangeMonths}
          />
          <TrendCard
            title="Net Income"
            hint="Revenue minus expenses — profit per month."
            color="#3b82f6"
            gradientId="perf-net"
            data={report.net_income_trend}
            rangeMonths={rangeMonths}
          />
        </div>
      )}
    </div>
  );
}
