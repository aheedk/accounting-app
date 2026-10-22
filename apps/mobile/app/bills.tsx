import { useMemo, useState } from 'react';
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
import { listBills, listVendors, type BillRow } from '../services/api';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { fmtMoney, fmtShortDate } from '../lib/money';
import { spacing, typeScale, fontFamily, minTouchTarget, type AppTheme } from '../theme';

type StatusFilter = 'all' | 'open' | 'overdue' | 'paid';
const FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All' }, { value: 'open', label: 'Open' },
  { value: 'overdue', label: 'Overdue' }, { value: 'paid', label: 'Paid' },
];
const todayIso = () => new Date().toISOString().slice(0, 10);

// Same screen as invoices.tsx (AR side), mirrored field-for-field for AP.
export default function BillsScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { activeBusinessId } = useAuth();
  const [filter, setFilter] = useState<StatusFilter>('all');

  const billsQuery = useQuery({
    queryKey: ['bills', activeBusinessId],
    queryFn: () => listBills(activeBusinessId!),
    enabled: !!activeBusinessId,
    staleTime: 5 * 60_000,
  });
  const vendorsQuery = useQuery({
    queryKey: ['vendors', activeBusinessId],
    queryFn: () => listVendors(activeBusinessId!),
    enabled: !!activeBusinessId,
    staleTime: 5 * 60_000,
  });

  const vendorNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of vendorsQuery.data ?? []) m.set(v.id, v.name);
    return m;
  }, [vendorsQuery.data]);

  const rows = useMemo(() => {
    const items = billsQuery.data ?? [];
    const today = todayIso();
    switch (filter) {
      case 'open': return items.filter(b => b.status === 'posted');
      case 'overdue': return items.filter(b => b.status === 'posted' && b.due_date < today);
      case 'paid': return items.filter(b => b.status === 'paid');
      default: return items;
    }
  }, [billsQuery.data, filter]);

  const loading = billsQuery.isLoading || vendorsQuery.isLoading;
  const anyError = billsQuery.error ?? vendorsQuery.error;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Bills" />

      <View style={styles.filterBar}>
        {FILTERS.map(f => (
          <AppChip
            key={f.value}
            label={f.label}
            active={filter === f.value}
            onPress={() => setFilter(f.value)}
            style={{ marginRight: spacing.xs }}
          />
        ))}
      </View>

      {loading ? (
        <LoadingIndicator />
      ) : anyError ? (
        <ErrorState onRetry={() => { void billsQuery.refetch(); void vendorsQuery.refetch(); }} />
      ) : (
        <FlashList
          data={rows}
          keyExtractor={b => b.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
          ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.app.border }} />}
          ListEmptyComponent={<EmptyState icon="file-document-outline" message="No bills match." />}
          renderItem={({ item }: { item: BillRow }) => (
            <BillRowItem row={item} vendorName={vendorNames.get(item.vendor_id)} theme={theme} />
          )}
        />
      )}
    </View>
  );
}

const BILL_BADGE: Record<string, BadgeStatus> = { posted: 'blue', paid: 'green', draft: 'gray', voided: 'red' };

function BillRowItem({ row, vendorName, theme }: { row: BillRow; vendorName: string | undefined; theme: AppTheme }) {
  const overdue = row.status === 'posted' && row.due_date < todayIso();
  return (
    <Pressable
      style={({ pressed }) => [styles.row, { minHeight: minTouchTarget + 16, opacity: pressed ? 0.6 : 1 }]}
      onPress={() => router.push({ pathname: '/bill/[id]', params: { id: row.id } })}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold, fontSize: typeScale.body }} numberOfLines={1}>
          {vendorName ?? 'Vendor'}{row.bill_number ? ` · #${row.bill_number}` : ''}
        </Text>
        <Text style={{ color: overdue ? theme.app.statusRedFg : theme.app.mutedForeground, fontSize: typeScale.caption }}>
          Due {fmtShortDate(row.due_date)}{overdue ? ' · Overdue' : ''}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold, fontSize: typeScale.body }}>${fmtMoney(row.total)}</Text>
        <StatusBadge status={BILL_BADGE[row.status] ?? 'gray'} label={row.status} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  filterBar: { flexDirection: 'row', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
