import { useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from './AppHeader';
import { AppCard } from './ui/AppCard';
import { DateField } from './DateField';
import type { AgingReport, AgingRow } from '../services/api';
import { LoadingIndicator } from './LoadingIndicator';
import { ErrorState } from './ErrorState';
import { EmptyState } from './EmptyState';
import { fmtMoney } from '../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../theme';

const todayIso = () => new Date().toISOString().slice(0, 10);

const BUCKETS: Array<{ key: keyof AgingRow; label: string }> = [
  { key: 'current', label: 'Current' },
  { key: 'days_1_30', label: '1-30' },
  { key: 'days_31_60', label: '31-60' },
  { key: 'days_61_90', label: '61-90' },
  { key: 'days_over_90', label: '91+' },
];

/**
 * Web's AgingReportPage.tsx renders one wide 7-column table (shared for
 * both AR/AP via a kind prop) — doesn't fit phone width as a table, so
 * mobile adapts it to a card per party (name + total up top, same, like
 * every other list row in this app) with the bucket breakdown as a small
 * grid underneath, only showing non-zero buckets (same "blank when zero"
 * convention web uses). Same data, same bucket boundaries, different
 * layout for the screen size — not a reinvented report.
 */
export function AgingReportView({
  title, partyLabel, reportKey, fetchReport,
}: {
  title: string;
  partyLabel: string;
  /** Distinguishes AR from AP in the react-query cache — e.g. 'ar-aging'/'ap-aging'. */
  reportKey: string;
  fetchReport: (businessId: string, asOf: string) => Promise<AgingReport>;
}) {
  const theme = useTheme<AppTheme>();
  const { activeBusinessId } = useAuth();
  const [asOf, setAsOf] = useState(todayIso());

  const query = useQuery({
    queryKey: [reportKey, activeBusinessId, asOf],
    queryFn: () => fetchReport(activeBusinessId!, asOf),
    enabled: !!activeBusinessId,
  });

  const bucketTotals = useMemo(() => {
    const rows = query.data?.rows ?? [];
    const totals: Record<string, number> = { current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_over_90: 0, total: 0 };
    for (const row of rows) {
      for (const b of BUCKETS) totals[b.key] += parseFloat(row[b.key] || '0');
      totals.total += parseFloat(row.total || '0');
    }
    return totals;
  }, [query.data]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title={title} />

      <View style={styles.dateRow}>
        <DateField label="As of" value={asOf} onChange={setAsOf} />
      </View>

      {query.isLoading ? (
        <LoadingIndicator />
      ) : query.error || !query.data ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : query.data.rows.length === 0 ? (
        <EmptyState icon="calendar-clock-outline" message={`No outstanding ${partyLabel.toLowerCase()} balances.`} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <AppCard style={{ marginBottom: spacing.md }}>
            <View style={styles.summaryHeader}>
              <Text style={{ color: theme.app.mutedForeground, fontFamily: fontFamily.semibold, fontSize: typeScale.caption, textTransform: 'uppercase' }}>Totals</Text>
              <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.bold, fontSize: typeScale.h3 }}>${fmtMoney(bucketTotals.total)}</Text>
            </View>
            <View style={styles.bucketGrid}>
              {BUCKETS.map(b => (
                bucketTotals[b.key] !== 0 ? (
                  <View key={b.key} style={styles.bucketCell}>
                    <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>{b.label}</Text>
                    <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium }}>${fmtMoney(bucketTotals[b.key])}</Text>
                  </View>
                ) : null
              ))}
            </View>
          </AppCard>

          {query.data.rows.map(row => (
            <AgingRowCard key={row.id} row={row} theme={theme} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function AgingRowCard({ row, theme }: { row: AgingRow; theme: AppTheme }) {
  return (
    <AppCard style={{ marginBottom: spacing.sm }}>
      <View style={styles.rowHeader}>
        <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold, fontSize: typeScale.body, flex: 1 }} numberOfLines={1}>
          {row.name}
        </Text>
        <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.bold, fontSize: typeScale.body }}>${fmtMoney(row.total)}</Text>
      </View>
      <View style={styles.bucketGrid}>
        {BUCKETS.map(b => (
          parseFloat(row[b.key] || '0') !== 0 ? (
            <View key={b.key} style={styles.bucketCell}>
              <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>{b.label}</Text>
              <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium }}>${fmtMoney(row[b.key])}</Text>
            </View>
          ) : null
        ))}
      </View>
    </AppCard>
  );
}

const styles = StyleSheet.create({
  dateRow: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  summaryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md, paddingBottom: spacing.sm },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md, paddingBottom: spacing.sm },
  bucketGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: spacing.md, paddingBottom: spacing.sm, gap: spacing.md },
  bucketCell: { minWidth: 64 },
});
