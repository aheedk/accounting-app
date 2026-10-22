import { View, StyleSheet } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { StatusBadge, type BadgeStatus } from '../components/ui/StatusBadge';
import { listReconciliationHistory, type ReconciliationHistoryRow } from '../services/api';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { fmtMoney, fmtShortDate } from '../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../theme';

const STATUS_BADGE: Record<string, BadgeStatus> = { completed: 'green', cancelled: 'gray' };

/**
 * Flat list across every account, same fields web's history/summary pages
 * show (minus the expandable QBO-style Deposits/Payments report view,
 * which isn't built this chunk — rows here are read-only, not tappable).
 */
export default function ReconciliationHistoryScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { activeBusinessId } = useAuth();

  const query = useQuery({
    queryKey: ['reconciliation-history', activeBusinessId],
    queryFn: () => listReconciliationHistory(activeBusinessId!),
    enabled: !!activeBusinessId,
  });

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Reconciliation History" leading="back" />

      {query.isLoading ? (
        <LoadingIndicator />
      ) : query.error ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <FlashList
          data={query.data ?? []}
          keyExtractor={r => r.id}
          contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + spacing.xxl }}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          ListEmptyComponent={<EmptyState icon="bank-check" message="No completed reconciliations yet." />}
          renderItem={({ item }: { item: ReconciliationHistoryRow }) => <HistoryRow row={item} theme={theme} />}
        />
      )}
    </View>
  );
}

function HistoryRow({ row, theme }: { row: ReconciliationHistoryRow; theme: AppTheme }) {
  return (
    <View style={[styles.card, { borderColor: theme.app.border, backgroundColor: theme.app.surface }]}>
      <View style={styles.header}>
        <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold, fontSize: typeScale.body, flex: 1 }} numberOfLines={1}>
          {row.account_code} — {row.account_name}
        </Text>
        <StatusBadge status={STATUS_BADGE[row.status] ?? 'gray'} label={row.status} />
      </View>
      <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption, marginTop: 2 }}>
        Through {fmtShortDate(row.statement_ending_date)}
        {row.completed_by ? ` · ${row.completed_by}` : ''}
      </Text>
      <View style={styles.statsRow}>
        <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium, fontSize: typeScale.caption }}>
          ${fmtMoney(row.statement_ending_balance)} statement
        </Text>
        <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>
          {row.items_cleared} cleared
        </Text>
        {parseFloat(row.difference) !== 0 ? (
          <Text style={{ color: theme.app.statusRedFg, fontSize: typeScale.caption }}>
            ${fmtMoney(Math.abs(parseFloat(row.difference)))} diff
          </Text>
        ) : null}
        {row.changes > 0 ? (
          <Text style={{ color: theme.app.statusRedFg, fontSize: typeScale.caption }}>
            {row.changes} changed since
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 6, padding: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statsRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs, flexWrap: 'wrap' },
});
