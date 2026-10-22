import { useMemo, useState } from 'react';
import { View, ScrollView } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { AppCard } from '../components/ui/AppCard';
import { AppSegmentedControl } from '../components/ui/AppSegmentedControl';
import { getPerformanceReport, type MonthAmount } from '../services/api';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { fmtMoney } from '../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../theme';

type RangeKey = '3m' | '6m' | '12m';
const RANGE_MONTHS: Record<RangeKey, number> = { '3m': 3, '6m': 6, '12m': 12 };

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'short' });
}

function slice(months: MonthAmount[], n: number): MonthAmount[] {
  return months.slice(Math.max(0, months.length - n));
}

function total(months: MonthAmount[]): number {
  return months.reduce((sum, m) => sum + parseFloat(m.amount), 0);
}

// Period-over-period delta: this range's total vs. the equal-length range
// immediately before it, computed client-side the same way web does (the
// API always returns the full 12 months; there's no server-side range
// param to ask for instead).
function deltaPct(months: MonthAmount[], n: number): number | null {
  const current = slice(months, n);
  const priorStart = Math.max(0, months.length - n * 2);
  const priorEnd = Math.max(0, months.length - n);
  const prior = months.slice(priorStart, priorEnd);
  const curTotal = total(current);
  const priorTotal = total(prior);
  if (prior.length < n || priorTotal === 0) return null;
  return ((curTotal - priorTotal) / Math.abs(priorTotal)) * 100;
}

export default function PerformanceCenterScreen() {
  const theme = useTheme<AppTheme>();
  const { activeBusinessId } = useAuth();
  const [range, setRange] = useState<RangeKey>('6m');

  const query = useQuery({
    queryKey: ['performance-report', activeBusinessId],
    queryFn: () => getPerformanceReport(activeBusinessId!),
    enabled: !!activeBusinessId,
  });

  const n = RANGE_MONTHS[range];
  const revenue = useMemo(() => (query.data ? slice(query.data.revenue_trend, n) : []), [query.data, n]);
  const expense = useMemo(() => (query.data ? slice(query.data.expense_trend, n) : []), [query.data, n]);
  const netIncome = useMemo(() => (query.data ? slice(query.data.net_income_trend, n) : []), [query.data, n]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Performance Center" />

      <View style={{ paddingHorizontal: spacing.md, paddingTop: spacing.sm }}>
        <AppSegmentedControl
          value={range}
          onChange={setRange}
          options={[{ value: '3m', label: '3M' }, { value: '6m', label: '6M' }, { value: '12m', label: '12M' }]}
        />
      </View>

      {query.isLoading ? (
        <LoadingIndicator />
      ) : query.error || !query.data ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.lg }}>
          <TrendCard
            title="Revenue" months={revenue} theme={theme} color={theme.app.statusGreenFg}
            delta={deltaPct(query.data.revenue_trend, n)}
          />
          <TrendCard
            title="Expenses" months={expense} theme={theme} color={theme.app.statusRedFg}
            delta={deltaPct(query.data.expense_trend, n)}
          />
          <TrendCard
            title="Net income" months={netIncome} theme={theme} color={theme.app.statusBlueFg}
            delta={deltaPct(query.data.net_income_trend, n)}
          />
        </ScrollView>
      )}
    </View>
  );
}

function TrendCard({
  title, months, theme, color, delta,
}: { title: string; months: MonthAmount[]; theme: AppTheme; color: string; delta: number | null }) {
  const totalAmount = total(months);
  const max = Math.max(1, ...months.map(m => Math.abs(parseFloat(m.amount))));

  return (
    <AppCard style={{ padding: spacing.md }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: spacing.sm }}>
        <View>
          <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption, fontFamily: fontFamily.medium }}>{title}</Text>
          <Text style={{ color: theme.app.foreground, fontSize: typeScale.h3, fontFamily: fontFamily.bold }}>${fmtMoney(String(totalAmount))}</Text>
        </View>
        {delta !== null ? (
          <Text style={{ color: delta >= 0 ? theme.app.statusGreenFg : theme.app.statusRedFg, fontFamily: fontFamily.semibold }}>
            {delta >= 0 ? '+' : ''}{delta.toFixed(1)}%
          </Text>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 60 }}>
        {months.map(m => {
          const v = parseFloat(m.amount);
          const pct = Math.max(4, (Math.abs(v) / max) * 100);
          return (
            <View key={m.month} style={{ flex: 1, alignItems: 'center' }}>
              <View style={{ width: '100%', height: 48, justifyContent: 'flex-end' }}>
                <View style={{ height: `${pct}%`, backgroundColor: color, borderRadius: 3, opacity: v < 0 ? 0.5 : 1 }} />
              </View>
              <Text style={{ color: theme.app.mutedForeground, fontSize: 10, marginTop: 2 }}>{monthLabel(m.month)}</Text>
            </View>
          );
        })}
      </View>
    </AppCard>
  );
}
