import { useState } from 'react';
import { View, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { hasMinRole, type Role } from '@accounting/shared';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { AppCard } from '../components/ui/AppCard';
import { AppButton } from '../components/ui/AppButton';
import { AppChip } from '../components/ui/AppChip';
import { StatusBadge, type BadgeStatus } from '../components/ui/StatusBadge';
import { listSalesOrders, listCustomers, type SalesOrder, type SalesOrderStatus } from '../services/api';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { fmtShortDate } from '../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../theme';

const STATUS_LABELS: Record<SalesOrderStatus, string> = {
  draft: 'Draft', confirmed: 'Confirmed', fulfilled: 'Fulfilled', void: 'Void',
};
const STATUS_BADGES: Record<SalesOrderStatus, BadgeStatus> = {
  draft: 'gray', confirmed: 'blue', fulfilled: 'green', void: 'red',
};

export default function SalesOrdersScreen() {
  const theme = useTheme<AppTheme>();
  const { activeBusinessId, businesses, user } = useAuth();
  const effectiveRole = (businesses.find(b => b.id === activeBusinessId)?.role_override ?? user?.role ?? 'viewer') as Role;
  const canCreate = hasMinRole(effectiveRole, 'staff');
  const [status, setStatus] = useState<SalesOrderStatus | undefined>(undefined);

  const query = useQuery({
    queryKey: ['sales-orders', activeBusinessId, status],
    queryFn: () => listSalesOrders(activeBusinessId!, status ? { status } : {}),
    enabled: !!activeBusinessId,
  });
  const customersQuery = useQuery({
    queryKey: ['customers', activeBusinessId],
    queryFn: () => listCustomers(activeBusinessId!),
    enabled: !!activeBusinessId, staleTime: 5 * 60_000,
  });

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Sales Orders" />

      <View style={{ paddingHorizontal: spacing.md, paddingTop: spacing.sm }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs }}>
          <AppChip label="All" active={!status} onPress={() => setStatus(undefined)} />
          {(Object.keys(STATUS_LABELS) as SalesOrderStatus[]).map(s => (
            <AppChip key={s} label={STATUS_LABELS[s]} active={status === s} onPress={() => setStatus(s)} />
          ))}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}>
        {canCreate ? (
          <AppButton onPress={() => router.push('/sales-order/new')} style={{ marginBottom: spacing.md }}>New Sales Order</AppButton>
        ) : null}

        {query.isLoading ? (
          <LoadingIndicator />
        ) : query.error ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : !query.data || query.data.length === 0 ? (
          <EmptyState icon="cart-outline" message="No sales orders yet." />
        ) : (
          <AppCard style={{ padding: 0 }}>
            {query.data.map((so: SalesOrder, i) => {
              const customer = customersQuery.data?.find(c => c.id === so.customer_id);
              return (
                <Pressable
                  key={so.id}
                  onPress={() => router.push({ pathname: '/sales-order/[id]', params: { id: so.id } })}
                  style={[styles.row, i !== query.data!.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.app.border }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium }} numberOfLines={1}>{so.so_number}{customer ? ` — ${customer.name}` : ''}</Text>
                    <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>{fmtShortDate(so.order_date)}</Text>
                  </View>
                  <StatusBadge status={STATUS_BADGES[so.status]} label={STATUS_LABELS[so.status]} />
                </Pressable>
              );
            })}
          </AppCard>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
