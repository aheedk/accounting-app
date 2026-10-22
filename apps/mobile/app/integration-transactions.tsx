import { useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { AppChip } from '../components/ui/AppChip';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { StatusBadge, type BadgeStatus } from '../components/ui/StatusBadge';
import { listIntegrationInbox, type IntegrationInboxRow, type IntegrationInboxStatus } from '../services/api';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { fmtMoney, fmtShortDate } from '../lib/money';
import { spacing, typeScale, fontFamily, minTouchTarget, type AppTheme } from '../theme';

type Filter = 'pending' | 'categorized' | 'matched' | 'excluded';
const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'pending', label: 'Pending' }, { value: 'categorized', label: 'Categorized' },
  { value: 'matched', label: 'Matched' }, { value: 'excluded', label: 'Excluded' },
];
const BADGE: Record<string, BadgeStatus> = { pending: 'blue', categorized: 'green', matched: 'green', excluded: 'gray' };
const SOURCE_LABEL: Record<string, string> = { stripe_csv: 'Stripe', paypal_csv: 'PayPal', shopify_csv: 'Shopify', generic: 'CSV import' };

/** Rows imported from a 3rd-party platform's CSV export — distinct from
 * both the bank feed (Bank Transactions) and the AI email inbox. Business-
 * wide, no per-account scoping (these rows don't belong to one bank
 * account the way a bank transaction does). */
export default function IntegrationTransactionsScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { activeBusinessId } = useAuth();
  const [filter, setFilter] = useState<Filter>('pending');

  const query = useQuery({
    queryKey: ['integration-inbox', activeBusinessId, filter],
    queryFn: () => listIntegrationInbox(activeBusinessId!, { status: filter as IntegrationInboxStatus }),
    enabled: !!activeBusinessId,
  });

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Integration Transactions" />

      <View style={styles.filterBar}>
        {FILTERS.map(f => (
          <AppChip key={f.value} label={f.label} active={filter === f.value} onPress={() => setFilter(f.value)} style={{ marginRight: spacing.xs }} />
        ))}
      </View>

      {query.isLoading ? (
        <LoadingIndicator />
      ) : query.error ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <FlashList
          data={query.data ?? []}
          keyExtractor={t => t.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
          ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.app.border }} />}
          ListEmptyComponent={<EmptyState icon="swap-horizontal" message="Nothing here." />}
          renderItem={({ item }: { item: IntegrationInboxRow }) => <RowItem row={item} theme={theme} />}
        />
      )}
    </View>
  );
}

function RowItem({ row, theme }: { row: IntegrationInboxRow; theme: AppTheme }) {
  const amount = parseFloat(row.amount);
  return (
    <Pressable
      style={({ pressed }) => [styles.row, { minHeight: minTouchTarget + 16, opacity: pressed ? 0.6 : 1 }]}
      onPress={() => router.push({ pathname: '/integration-transaction/[id]', params: { id: row.id } })}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold, fontSize: typeScale.body }} numberOfLines={1}>
          {row.description}
        </Text>
        <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>
          {fmtShortDate(row.occurred_at)} · {SOURCE_LABEL[row.source] ?? row.source}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <Text style={{ color: amount >= 0 ? theme.app.statusGreenFg : theme.app.foreground, fontFamily: fontFamily.semibold, fontSize: typeScale.body }}>
          {amount >= 0 ? '+' : '-'}${fmtMoney(Math.abs(amount))}
        </Text>
        <StatusBadge status={BADGE[row.status] ?? 'gray'} label={row.status} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  filterBar: { flexDirection: 'row', paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
