import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { AppCard } from '../components/ui/AppCard';
import { getManagementReport, type MonthAmount } from '../services/api';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { fmtMoney } from '../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../theme';

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'short' });
}

export default function ManagementReportsScreen() {
  const theme = useTheme<AppTheme>();
  const { activeBusinessId } = useAuth();

  const query = useQuery({
    queryKey: ['management-report', activeBusinessId],
    queryFn: () => getManagementReport(activeBusinessId!),
    enabled: !!activeBusinessId,
  });

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Management Reports" />

      {query.isLoading ? (
        <LoadingIndicator />
      ) : query.error || !query.data ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}>
          <View style={styles.summaryRow}>
            <AppCard style={styles.summaryCard}>
              <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption, fontFamily: fontFamily.medium }}>Revenue, last 12 months</Text>
              <Text style={{ color: theme.app.foreground, fontSize: typeScale.h3, fontFamily: fontFamily.bold, marginTop: 2 }}>${fmtMoney(query.data.total_revenue_last_12)}</Text>
            </AppCard>
            <AppCard style={styles.summaryCard}>
              <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption, fontFamily: fontFamily.medium }}>Expense, last 12 months</Text>
              <Text style={{ color: theme.app.foreground, fontSize: typeScale.h3, fontFamily: fontFamily.bold, marginTop: 2 }}>${fmtMoney(query.data.total_expense_last_12)}</Text>
            </AppCard>
          </View>

          <Text style={{ fontSize: typeScale.h3, fontFamily: fontFamily.semibold, color: theme.app.foreground, marginBottom: spacing.sm }}>
            Revenue by month
          </Text>
          <AppCard style={{ marginBottom: spacing.lg }}>
            <MonthBars months={query.data.revenue_by_month} theme={theme} color={theme.app.statusGreenFg} />
          </AppCard>

          <Text style={{ fontSize: typeScale.h3, fontFamily: fontFamily.semibold, color: theme.app.foreground, marginBottom: spacing.sm }}>
            Top expense accounts
          </Text>
          <AppCard style={{ padding: 0 }}>
            {query.data.expense_breakdown.length === 0 ? (
              <View style={{ padding: spacing.md }}>
                <Text style={{ color: theme.app.mutedForeground }}>No expense activity in the last 12 months.</Text>
              </View>
            ) : (
              query.data.expense_breakdown.map((row, i) => (
                <View
                  key={row.account_code}
                  style={[
                    styles.lineRow,
                    i !== query.data!.expense_breakdown.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.app.border },
                  ]}
                >
                  <Text style={{ color: theme.app.foreground, flex: 1 }} numberOfLines={1}>{row.account_code} — {row.account_name}</Text>
                  <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium }}>${fmtMoney(row.amount)}</Text>
                </View>
              ))
            )}
          </AppCard>
        </ScrollView>
      )}
    </View>
  );
}

function MonthBars({ months, theme, color }: { months: MonthAmount[]; theme: AppTheme; color: string }) {
  const max = Math.max(1, ...months.map(m => Math.abs(parseFloat(m.amount))));
  return (
    <View style={{ padding: spacing.md, gap: spacing.xs }}>
      {months.map(m => {
        const v = parseFloat(m.amount);
        const pct = Math.max(2, (Math.abs(v) / max) * 100);
        return (
          <View key={m.month} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Text style={{ width: 32, color: theme.app.mutedForeground, fontSize: typeScale.caption }}>{monthLabel(m.month)}</Text>
            <View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: theme.app.muted, overflow: 'hidden' }}>
              <View style={{ width: `${pct}%`, height: '100%', backgroundColor: color, borderRadius: 4 }} />
            </View>
            <Text style={{ width: 72, textAlign: 'right', color: theme.app.foreground, fontSize: typeScale.caption, fontFamily: fontFamily.medium }}>
              ${fmtMoney(m.amount)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  summaryRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  summaryCard: { flex: 1, padding: spacing.sm },
  lineRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
