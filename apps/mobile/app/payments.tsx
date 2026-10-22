import { useMemo, useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { AppChip } from '../components/ui/AppChip';
import { StatusBadge, statusToBadge } from '../components/ui/StatusBadge';
import { useCanOpen } from '../lib/roleAccess';
import { listPayments, listCustomers, type PaymentRow } from '../services/api';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { fmtMoney, fmtShortDate } from '../lib/money';
import { spacing, typeScale, fontFamily, minTouchTarget, type AppTheme } from '../theme';

type StatusFilter = 'all' | 'draft' | 'posted' | 'voided';
const FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All' }, { value: 'posted', label: 'Posted' },
  { value: 'draft', label: 'Draft' }, { value: 'voided', label: 'Voided' },
];

export default function PaymentsScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { activeBusinessId } = useAuth();
  const canOpen = useCanOpen();
  const [filter, setFilter] = useState<StatusFilter>('all');

  const paymentsQuery = useQuery({
    queryKey: ['payments', activeBusinessId, filter],
    queryFn: () => listPayments(activeBusinessId!, filter === 'all' ? {} : { status: filter }),
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

  const loading = paymentsQuery.isLoading || customersQuery.isLoading;
  const anyError = paymentsQuery.error ?? customersQuery.error;
  const canCreate = canOpen('/payment/new');

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Payments" />

      <View style={styles.filterBar}>
        <View style={styles.chipRow}>
          {FILTERS.map(f => (
            <AppChip key={f.value} label={f.label} active={filter === f.value} onPress={() => setFilter(f.value)} style={{ marginRight: spacing.xs }} />
          ))}
        </View>
        {canCreate ? (
          <Pressable style={[styles.addButton, { backgroundColor: theme.app.primary }]} onPress={() => router.push('/payment/new')}>
            <MaterialCommunityIcons name="plus" size={18} color={theme.app.primaryForeground} />
            <Text style={{ color: theme.app.primaryForeground, fontFamily: fontFamily.semibold, fontSize: typeScale.body }}>Record payment</Text>
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <LoadingIndicator />
      ) : anyError ? (
        <ErrorState onRetry={() => { void paymentsQuery.refetch(); void customersQuery.refetch(); }} />
      ) : (
        <FlashList
          data={paymentsQuery.data ?? []}
          keyExtractor={p => p.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
          ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.app.border }} />}
          ListEmptyComponent={<EmptyState icon="cash-check" message="No payments match." />}
          renderItem={({ item }: { item: PaymentRow }) => (
            <PaymentRowItem payment={item} customerName={customerNames.get(item.customer_id)} theme={theme} />
          )}
        />
      )}
    </View>
  );
}

function PaymentRowItem({ payment, customerName, theme }: { payment: PaymentRow; customerName: string | undefined; theme: AppTheme }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, { minHeight: minTouchTarget + 16, opacity: pressed ? 0.6 : 1 }]}
      onPress={() => router.push({ pathname: '/payment/[id]', params: { id: payment.id } })}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold, fontSize: typeScale.body }} numberOfLines={1}>
          {customerName ?? 'Customer'}
        </Text>
        <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>
          {fmtShortDate(payment.payment_date)}{payment.reference ? ` · ${payment.reference}` : ''}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold, fontSize: typeScale.body }}>${fmtMoney(payment.amount)}</Text>
        <StatusBadge status={statusToBadge(payment.status)} label={payment.status} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  filterBar: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm, gap: spacing.sm },
  chipRow: { flexDirection: 'row' },
  addButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    minHeight: minTouchTarget - 4, borderRadius: 6,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
