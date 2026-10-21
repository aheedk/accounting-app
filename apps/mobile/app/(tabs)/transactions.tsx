import { useMemo, useState } from 'react';
import { View, StyleSheet, RefreshControl, Pressable } from 'react-native';
import { Text, TextInput, useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuth } from '../../hooks/useAuth';
import { AppHeader } from '../../components/AppHeader';
import { TransactionFilterPanel } from '../../components/TransactionFilterPanel';
import { StatusBadge, statusToBadge } from '../../components/ui/StatusBadge';
import { listTransactions, type TransactionRow } from '../../services/api';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { ErrorState } from '../../components/ErrorState';
import { EmptyState } from '../../components/EmptyState';
import { fmtMoney, fmtShortDate } from '../../lib/money';
import { EMPTY_FILTERS, countActiveFilters, presetRange, type TransactionFilters } from '../../lib/transactionFilters';
import { spacing, typeScale, fontFamily, minTouchTarget, type AppTheme } from '../../theme';

export default function TransactionsScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { businesses, activeBusinessId } = useAuth();
  const [filters, setFilters] = useState<TransactionFilters>(EMPTY_FILTERS);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [search, setSearch] = useState('');

  const fiscalStartMonth = businesses.find(b => b.id === activeBusinessId)?.fiscal_year_start_month ?? 1;
  const range = useMemo(
    () => presetRange(filters.datePreset, filters.dateStart, filters.dateEnd, fiscalStartMonth),
    [filters.datePreset, filters.dateStart, filters.dateEnd, fiscalStartMonth],
  );

  const query = useQuery({
    queryKey: ['transactions', activeBusinessId, filters, range.start, range.end],
    queryFn: () => listTransactions(activeBusinessId!, {
      limit: 200,
      type: filters.type || undefined,
      contact_id: filters.contactId ?? undefined,
      date_start: range.start ?? undefined,
      date_end: range.end ?? undefined,
      ref_no: filters.refNo.trim() || undefined,
      amount_op: filters.amountOp ?? undefined,
      amount_value: filters.amountValue || undefined,
      amount_value2: filters.amountValue2 || undefined,
    }),
    enabled: !!activeBusinessId,
  });

  const rows = useMemo(() => {
    const items = query.data?.transactions ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(r => (r.contact_name ?? '').toLowerCase().includes(q) || (r.memo ?? '').toLowerCase().includes(q));
  }, [query.data, search]);

  const activeCount = countActiveFilters(filters);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Transactions" />
      <View style={styles.header}>
        <View style={styles.searchRow}>
          <TextInput
            mode="outlined"
            placeholder="Search payee or memo"
            value={search}
            onChangeText={setSearch}
            dense
            style={{ flex: 1, backgroundColor: theme.app.surface }}
            left={<TextInput.Icon icon="magnify" />}
          />
          <Pressable
            onPress={() => setFilterPanelOpen(true)}
            style={[styles.filterButton, { borderColor: activeCount > 0 ? theme.app.primary : theme.app.border, backgroundColor: theme.app.surface }]}
          >
            <MaterialCommunityIcons name="filter-variant" size={18} color={activeCount > 0 ? theme.app.primary : theme.app.foreground} />
            <Text style={{ color: activeCount > 0 ? theme.app.primary : theme.app.foreground, fontFamily: fontFamily.medium, fontSize: typeScale.body }}>
              Filter{activeCount > 0 ? ` (${activeCount})` : ''}
            </Text>
          </Pressable>
        </View>
      </View>

      <TransactionFilterPanel
        visible={filterPanelOpen}
        onDismiss={() => setFilterPanelOpen(false)}
        filters={filters}
        onApply={(next) => { setFilters(next); setFilterPanelOpen(false); }}
      />

      {query.isLoading ? (
        <LoadingIndicator />
      ) : query.error ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <FlashList
          data={rows}
          keyExtractor={(r: TransactionRow) => `${r.type}:${r.id}`}
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
          refreshControl={<RefreshControl refreshing={query.isFetching && !query.isLoading} onRefresh={() => void query.refetch()} tintColor={theme.app.primary} />}
          ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.app.border }} />}
          ListEmptyComponent={<EmptyState icon="format-list-bulleted" message="No transactions match." />}
          renderItem={({ item }: { item: TransactionRow }) => (
            // item.path is the WEB app's route (e.g. /accounting/expenses/:id),
            // not a mobile screen — navigate by type+id to our own detail route
            // instead. Unsupported types land on a graceful dead-end there.
            <TransactionRowItem
              row={item}
              theme={theme}
              onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: item.id, type: item.type } })}
            />
          )}
        />
      )}
    </View>
  );
}

function TransactionRowItem({ row, theme, onPress }: { row: TransactionRow; theme: AppTheme; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, { minHeight: minTouchTarget + 16, opacity: pressed ? 0.6 : 1 }]}
      onPress={onPress}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold, fontSize: typeScale.body }} numberOfLines={1}>
          {row.contact_name ?? row.memo ?? row.type}
        </Text>
        <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }} numberOfLines={1}>
          {fmtShortDate(row.date)}{row.ref_no ? ` · #${row.ref_no}` : ''}{row.category ? ` · ${row.category}` : ''}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold, fontSize: typeScale.body }}>${fmtMoney(row.total_amount)}</Text>
        <StatusBadge status={statusToBadge(row.status)} label={row.status} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { padding: spacing.md, paddingBottom: spacing.sm },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  filterButton: {
    flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 6,
    paddingHorizontal: spacing.sm, minHeight: minTouchTarget,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
