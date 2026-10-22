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
import { listBillPayments, listVendors, type BillPaymentRow } from '../services/api';
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

// Same screen as payments.tsx (AR side), mirrored field-for-field for AP.
export default function BillPaymentsScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { activeBusinessId } = useAuth();
  const canOpen = useCanOpen();
  const [filter, setFilter] = useState<StatusFilter>('all');

  const paymentsQuery = useQuery({
    queryKey: ['bill-payments', activeBusinessId, filter],
    queryFn: () => listBillPayments(activeBusinessId!, filter === 'all' ? {} : { status: filter }),
    enabled: !!activeBusinessId,
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

  const loading = paymentsQuery.isLoading || vendorsQuery.isLoading;
  const anyError = paymentsQuery.error ?? vendorsQuery.error;
  const canCreate = canOpen('/bill-payment/new');

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Bill Payments" />

      <View style={styles.filterBar}>
        <View style={styles.chipRow}>
          {FILTERS.map(f => (
            <AppChip key={f.value} label={f.label} active={filter === f.value} onPress={() => setFilter(f.value)} style={{ marginRight: spacing.xs }} />
          ))}
        </View>
        {canCreate ? (
          <Pressable style={[styles.addButton, { backgroundColor: theme.app.primary }]} onPress={() => router.push('/bill-payment/new')}>
            <MaterialCommunityIcons name="plus" size={18} color={theme.app.primaryForeground} />
            <Text style={{ color: theme.app.primaryForeground, fontFamily: fontFamily.semibold, fontSize: typeScale.body }}>Pay bills</Text>
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <LoadingIndicator />
      ) : anyError ? (
        <ErrorState onRetry={() => { void paymentsQuery.refetch(); void vendorsQuery.refetch(); }} />
      ) : (
        <FlashList
          data={paymentsQuery.data ?? []}
          keyExtractor={p => p.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
          ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.app.border }} />}
          ListEmptyComponent={<EmptyState icon="cash-check" message="No bill payments match." />}
          renderItem={({ item }: { item: BillPaymentRow }) => (
            <BillPaymentRowItem payment={item} vendorName={vendorNames.get(item.vendor_id)} theme={theme} />
          )}
        />
      )}
    </View>
  );
}

function BillPaymentRowItem({ payment, vendorName, theme }: { payment: BillPaymentRow; vendorName: string | undefined; theme: AppTheme }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, { minHeight: minTouchTarget + 16, opacity: pressed ? 0.6 : 1 }]}
      onPress={() => router.push({ pathname: '/bill-payment/[id]', params: { id: payment.id } })}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold, fontSize: typeScale.body }} numberOfLines={1}>
          {vendorName ?? 'Vendor'}
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
