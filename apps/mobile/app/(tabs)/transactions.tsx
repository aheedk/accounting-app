import { useMemo, useState } from 'react';
import { View, StyleSheet, RefreshControl, Pressable } from 'react-native';
import { Text, TextInput, Chip, useTheme } from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuth } from '../../hooks/useAuth';
import { listTransactions, type TransactionRow } from '../../services/api';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { ErrorState } from '../../components/ErrorState';
import { EmptyState } from '../../components/EmptyState';
import { fmtMoney, fmtShortDate } from '../../lib/money';
import { spacing, typeScale, minTouchTarget, type AppTheme } from '../../theme';

const TYPE_FILTERS = [
  { value: '', label: 'All' },
  { value: 'deposit', label: 'Deposits' },
  { value: 'expense', label: 'Expenses' },
  { value: 'check', label: 'Checks' },
  { value: 'journal', label: 'JEs' },
  { value: 'bill', label: 'Bills' },
  { value: 'invoice', label: 'Invoices' },
] as const;

export default function TransactionsScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { activeBusinessId } = useAuth();
  const [typeFilter, setTypeFilter] = useState('');
  const [search, setSearch] = useState('');

  const query = useQuery({
    queryKey: ['transactions', activeBusinessId, { type: typeFilter }],
    queryFn: () => listTransactions(activeBusinessId!, { limit: 200, type: typeFilter || undefined }),
    enabled: !!activeBusinessId,
  });

  const rows = useMemo(() => {
    const items = query.data?.transactions ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(r => (r.contact_name ?? '').toLowerCase().includes(q) || (r.memo ?? '').toLowerCase().includes(q));
  }, [query.data, search]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background, paddingTop: insets.top }}>
      <View style={styles.header}>
        <Text style={{ fontSize: typeScale.h1, fontWeight: '700', color: theme.app.foreground }}>Transactions</Text>
        <TextInput
          mode="outlined"
          placeholder="Search payee or memo"
          value={search}
          onChangeText={setSearch}
          dense
          style={{ marginTop: spacing.sm, backgroundColor: theme.app.surface }}
          left={<TextInput.Icon icon="magnify" />}
        />
      </View>

      <FlashList
        horizontal
        data={TYPE_FILTERS as unknown as { value: string; label: string }[]}
        keyExtractor={f => f.value}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: spacing.md, paddingBottom: spacing.sm }}
        style={{ flexGrow: 0, marginBottom: spacing.xs }}
        renderItem={({ item }) => (
          <Chip
            selected={typeFilter === item.value}
            onPress={() => setTypeFilter(item.value)}
            style={{ marginRight: spacing.xs, minHeight: minTouchTarget - 12 }}
            selectedColor={theme.app.primary}
          >
            {item.label}
          </Chip>
        )}
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
        <Text style={{ color: theme.app.foreground, fontWeight: '600' }} numberOfLines={1}>
          {row.contact_name ?? row.memo ?? row.type}
        </Text>
        <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }} numberOfLines={1}>
          {fmtShortDate(row.date)}{row.ref_no ? ` · #${row.ref_no}` : ''}{row.category ? ` · ${row.category}` : ''}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ color: theme.app.foreground, fontWeight: '700' }}>${fmtMoney(row.total_amount)}</Text>
        <StatusPill status={row.status} theme={theme} />
      </View>
    </Pressable>
  );
}

function StatusPill({ status, theme }: { status: string; theme: AppTheme }) {
  const map: Record<string, { bg: string; fg: string }> = {
    posted: { bg: theme.app.statusGreenBg, fg: theme.app.statusGreenFg },
    paid: { bg: theme.app.statusGreenBg, fg: theme.app.statusGreenFg },
    draft: { bg: theme.app.statusGrayBg, fg: theme.app.statusGrayFg },
    voided: { bg: theme.app.statusRedBg, fg: theme.app.statusRedFg },
  };
  const c = map[status] ?? { bg: theme.app.statusGrayBg, fg: theme.app.statusGrayFg };
  return (
    <View style={{ backgroundColor: c.bg, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, marginTop: 2 }}>
      <Text style={{ color: c.fg, fontSize: 10, fontWeight: '600', textTransform: 'capitalize' }}>{status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { padding: spacing.md, paddingBottom: 0 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
