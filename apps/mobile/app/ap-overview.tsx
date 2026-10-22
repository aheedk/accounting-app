import { View, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { AppCard } from '../components/ui/AppCard';
import { getApOverview } from '../services/api';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { fmtMoney } from '../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../theme';

export default function ApOverviewScreen() {
  const theme = useTheme<AppTheme>();
  const { activeBusinessId } = useAuth();

  const query = useQuery({
    queryKey: ['ap-overview', activeBusinessId],
    queryFn: () => getApOverview(activeBusinessId!),
    enabled: !!activeBusinessId,
  });

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="AP Overview" />

      {query.isLoading ? (
        <LoadingIndicator />
      ) : query.error || !query.data ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.kpiGrid}>
            <Kpi theme={theme} label="Outstanding bills" value={query.data.outstanding_bills_total}
              sub={`$${fmtMoney(query.data.net_payable_total)} net payable`} />
            <Kpi theme={theme} label="Overdue bills" value={String(query.data.overdue_bills_count)} plain
              tint={query.data.overdue_bills_count > 0 ? theme.app.statusRedFg : undefined} />
            <Kpi theme={theme} label="Due in 7 days" value={query.data.upcoming_payments_7d} />
            <Kpi theme={theme} label="Due in 30 days" value={query.data.upcoming_payments_30d} />
          </View>

          <Text style={[styles.sectionTitle, { color: theme.app.foreground }]}>Top vendors by balance</Text>
          {query.data.top_vendors.length === 0 ? (
            <EmptyState icon="wallet-outline" message="No outstanding vendor balances." compact />
          ) : (
            <AppCard>
              {query.data.top_vendors.map((v, i) => (
                <Pressable
                  key={v.vendor_id}
                  style={[styles.vendorRow, i < query.data!.top_vendors.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.app.border }]}
                  onPress={() => router.push({ pathname: '/vendor/[id]', params: { id: v.vendor_id } })}
                >
                  <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium, flex: 1 }} numberOfLines={1}>{v.vendor_name}</Text>
                  <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold }}>${fmtMoney(v.outstanding)}</Text>
                </Pressable>
              ))}
            </AppCard>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function Kpi({ theme, label, value, sub, tint, plain }: { theme: AppTheme; label: string; value: string; sub?: string; tint?: string; plain?: boolean }) {
  return (
    <AppCard style={styles.kpiCard}>
      <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>{label}</Text>
      <Text style={{ color: tint ?? theme.app.foreground, fontFamily: fontFamily.bold, fontSize: typeScale.h2, marginTop: 2 }} numberOfLines={1}>
        {plain ? value : `$${fmtMoney(value)}`}
      </Text>
      {sub ? <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption, marginTop: 2 }} numberOfLines={1}>{sub}</Text> : null}
    </AppCard>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  kpiCard: { width: '47%', padding: spacing.md },
  sectionTitle: { fontSize: typeScale.h3, fontFamily: fontFamily.semibold, marginBottom: spacing.sm },
  vendorRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.md },
});
