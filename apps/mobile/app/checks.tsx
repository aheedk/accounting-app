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
import { listChecks, type CheckListRow } from '../services/api';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { fmtMoney, fmtShortDate } from '../lib/money';
import { spacing, typeScale, fontFamily, minTouchTarget, type AppTheme } from '../theme';

type StatusFilter = 'all' | 'draft' | 'posted' | 'void';
const FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All' }, { value: 'posted', label: 'Posted' },
  { value: 'draft', label: 'Draft' }, { value: 'void', label: 'Void' },
];
const CHECK_BADGE: Record<string, BadgeStatus> = { posted: 'green', draft: 'gray', void: 'red' };

export default function ChecksScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { activeBusinessId } = useAuth();
  const [filter, setFilter] = useState<StatusFilter>('all');

  const checksQuery = useQuery({
    queryKey: ['checks', activeBusinessId],
    queryFn: () => listChecks(activeBusinessId!),
    enabled: !!activeBusinessId,
    staleTime: 60_000,
  });

  const rows = (checksQuery.data ?? []).filter(c => filter === 'all' || c.status === filter);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Checks" />

      <View style={styles.filterBar}>
        {FILTERS.map(f => (
          <AppChip key={f.value} label={f.label} active={filter === f.value} onPress={() => setFilter(f.value)} style={{ marginRight: spacing.xs }} />
        ))}
      </View>

      {checksQuery.isLoading ? (
        <LoadingIndicator />
      ) : checksQuery.error ? (
        <ErrorState onRetry={() => void checksQuery.refetch()} />
      ) : (
        <FlashList
          data={rows}
          keyExtractor={c => c.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
          ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.app.border }} />}
          ListEmptyComponent={<EmptyState icon="checkbook" message="No checks match." />}
          renderItem={({ item }: { item: CheckListRow }) => <CheckRowItem row={item} theme={theme} />}
        />
      )}
    </View>
  );
}

function CheckRowItem({ row, theme }: { row: CheckListRow; theme: AppTheme }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, { minHeight: minTouchTarget + 16, opacity: pressed ? 0.6 : 1 }]}
      onPress={() => router.push({
        pathname: '/transaction/[id]',
        params: { id: row.id, type: row.legacy ? 'expense' : 'check' },
      })}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold, fontSize: typeScale.body }} numberOfLines={1}>
          {row.payee_name ?? 'Check'}{row.check_number ? ` · #${row.check_number}` : ''}
        </Text>
        <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }} numberOfLines={1}>
          {fmtShortDate(row.payment_date)}{row.bank_account_name ? ` · ${row.bank_account_name}` : ''}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold, fontSize: typeScale.body }}>${fmtMoney(row.total_amount)}</Text>
        <StatusBadge status={CHECK_BADGE[row.status] ?? 'gray'} label={row.status} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  filterBar: { flexDirection: 'row', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
