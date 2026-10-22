import { useMemo, useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AppChip } from '../components/ui/AppChip';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { hasMinRole, type Role } from '@accounting/shared';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { StatusBadge, type BadgeStatus } from '../components/ui/StatusBadge';
import { listCreditMemos, listCustomers, type CreditMemoRow } from '../services/api';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { fmtMoney, fmtShortDate } from '../lib/money';
import { spacing, typeScale, fontFamily, minTouchTarget, type AppTheme } from '../theme';

type StatusFilter = 'all' | 'draft' | 'posted' | 'applied' | 'voided';
const FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All' }, { value: 'posted', label: 'Posted' },
  { value: 'applied', label: 'Applied' }, { value: 'draft', label: 'Draft' }, { value: 'voided', label: 'Voided' },
];

export default function CreditMemosScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { activeBusinessId, businesses, user } = useAuth();
  const [filter, setFilter] = useState<StatusFilter>('all');

  const memosQuery = useQuery({
    queryKey: ['credit-memos', activeBusinessId],
    queryFn: () => listCreditMemos(activeBusinessId!),
    enabled: !!activeBusinessId,
  });
  const customersQuery = useQuery({
    queryKey: ['customers', activeBusinessId],
    queryFn: () => listCustomers(activeBusinessId!),
    enabled: !!activeBusinessId,
    staleTime: 5 * 60_000,
  });

  const customerNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of customersQuery.data ?? []) m.set(c.id, c.name);
    return m;
  }, [customersQuery.data]);

  const rows = useMemo(() => {
    const items = memosQuery.data ?? [];
    return filter === 'all' ? items : items.filter(m => m.status === filter);
  }, [memosQuery.data, filter]);

  const loading = memosQuery.isLoading || customersQuery.isLoading;
  const anyError = memosQuery.error ?? customersQuery.error;
  // Credit memo creation is accountant+ server-side (stricter than the
  // staff-level default) — gated here directly rather than via
  // useCanOpen, which only knows the generic viewer/client rules.
  const effectiveRole = (businesses.find(b => b.id === activeBusinessId)?.role_override ?? user?.role ?? 'viewer') as Role;
  const canCreate = hasMinRole(effectiveRole, 'accountant');

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Credit Memos" />

      <View style={styles.filterBar}>
        <View style={styles.chipRow}>
          {FILTERS.map(f => (
            <AppChip key={f.value} label={f.label} active={filter === f.value} onPress={() => setFilter(f.value)} style={{ marginRight: spacing.xs, marginBottom: spacing.xs }} />
          ))}
        </View>
        {canCreate ? (
          <Pressable style={[styles.addButton, { backgroundColor: theme.app.primary }]} onPress={() => router.push('/credit-memo/new')}>
            <MaterialCommunityIcons name="plus" size={18} color={theme.app.primaryForeground} />
            <Text style={{ color: theme.app.primaryForeground, fontFamily: fontFamily.semibold, fontSize: typeScale.body }}>New credit memo</Text>
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <LoadingIndicator />
      ) : anyError ? (
        <ErrorState onRetry={() => { void memosQuery.refetch(); void customersQuery.refetch(); }} />
      ) : (
        <FlashList
          data={rows}
          keyExtractor={m => m.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
          ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.app.border }} />}
          ListEmptyComponent={<EmptyState icon="file-document-outline" message="No credit memos match." />}
          renderItem={({ item }: { item: CreditMemoRow }) => (
            <MemoRowItem row={item} customerName={customerNames.get(item.customer_id)} theme={theme} />
          )}
        />
      )}
    </View>
  );
}

// Credit memo status is its own vocabulary, same reasoning as invoices.tsx's
// local INVOICE_BADGE: "posted" here means an active, unspent credit, not
// a settled/paid state, so it gets blue (open) rather than the generic
// posted=green convention; "applied" (fully used up) is the green/settled
// state instead.
const CM_BADGE: Record<string, BadgeStatus> = { posted: 'blue', applied: 'green', draft: 'gray', voided: 'red' };

function MemoRowItem({ row, customerName, theme }: { row: CreditMemoRow; customerName: string | undefined; theme: AppTheme }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, { minHeight: minTouchTarget + 16, opacity: pressed ? 0.6 : 1 }]}
      onPress={() => router.push({ pathname: '/credit-memo/[id]', params: { id: row.id } })}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold, fontSize: typeScale.body }} numberOfLines={1}>
          {customerName ?? 'Customer'}{row.credit_memo_number ? ` · ${row.credit_memo_number}` : ''}
        </Text>
        <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>
          {fmtShortDate(row.memo_date)}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold, fontSize: typeScale.body }}>${fmtMoney(row.amount)}</Text>
        <StatusBadge status={CM_BADGE[row.status] ?? 'gray'} label={row.status} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  filterBar: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm, gap: spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap' },
  addButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    minHeight: minTouchTarget - 4, borderRadius: 6,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
