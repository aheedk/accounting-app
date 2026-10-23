import { View, StyleSheet, ScrollView, Alert } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { hasMinRole, type Role } from '@accounting/shared';
import { useAuth } from '../../hooks/useAuth';
import { AppHeader } from '../../components/AppHeader';
import { AppCard } from '../../components/ui/AppCard';
import { AppButton } from '../../components/ui/AppButton';
import { StatusBadge, type BadgeStatus } from '../../components/ui/StatusBadge';
import { getSalesOrder, listCustomers, listInventoryItems, fulfillSalesOrder, voidSalesOrder, type SalesOrderStatus } from '../../services/api';
import { pickErr } from '../../services/apiClient';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { ErrorState } from '../../components/ErrorState';
import { fmtMoney, fmtShortDate } from '../../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../../theme';

const STATUS_LABELS: Record<SalesOrderStatus, string> = {
  draft: 'Draft', confirmed: 'Confirmed', fulfilled: 'Fulfilled', void: 'Void',
};
const STATUS_BADGES: Record<SalesOrderStatus, BadgeStatus> = {
  draft: 'gray', confirmed: 'blue', fulfilled: 'green', void: 'red',
};

export default function SalesOrderDetailScreen() {
  const theme = useTheme<AppTheme>();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { activeBusinessId, businesses, user } = useAuth();
  const queryClient = useQueryClient();
  const effectiveRole = (businesses.find(b => b.id === activeBusinessId)?.role_override ?? user?.role ?? 'viewer') as Role;
  const canAct = hasMinRole(effectiveRole, 'accountant');

  const query = useQuery({
    queryKey: ['sales-order', activeBusinessId, id],
    queryFn: () => getSalesOrder(activeBusinessId!, id!),
    enabled: !!activeBusinessId && !!id,
  });
  const customersQuery = useQuery({
    queryKey: ['customers', activeBusinessId],
    queryFn: () => listCustomers(activeBusinessId!),
    enabled: !!activeBusinessId, staleTime: 5 * 60_000,
  });
  const itemsQuery = useQuery({
    queryKey: ['inventory-items', activeBusinessId],
    queryFn: () => listInventoryItems(activeBusinessId!, { include_inactive: true }),
    enabled: !!activeBusinessId, staleTime: 5 * 60_000,
  });

  async function invalidate() {
    await queryClient.invalidateQueries({ queryKey: ['sales-order', activeBusinessId, id] });
    await queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
  }

  function handleFulfill() {
    Alert.alert('Fulfill this sales order?', 'This creates the linked invoice.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Fulfill',
        onPress: () => {
          void (async () => {
            try {
              await fulfillSalesOrder(activeBusinessId!, id!);
              await invalidate();
            } catch (e) {
              Alert.alert("Couldn't fulfill", pickErr(e));
            }
          })();
        },
      },
    ]);
  }

  function handleVoid() {
    Alert.alert('Void this sales order?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Void', style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await voidSalesOrder(activeBusinessId!, id!);
              await invalidate();
            } catch (e) {
              Alert.alert("Couldn't void", pickErr(e));
            }
          })();
        },
      },
    ]);
  }

  if (query.isLoading) {
    return <View style={{ flex: 1, backgroundColor: theme.colors.background }}><AppHeader title="Sales Order" leading="back" /><LoadingIndicator /></View>;
  }
  if (query.error || !query.data) {
    return <View style={{ flex: 1, backgroundColor: theme.colors.background }}><AppHeader title="Sales Order" leading="back" /><ErrorState onRetry={() => void query.refetch()} /></View>;
  }

  const so = query.data;
  const customer = customersQuery.data?.find(c => c.id === so.customer_id);
  const total = so.lines.reduce((sum, l) => sum + parseFloat(l.quantity) * parseFloat(l.unit_price), 0);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title={so.so_number} leading="back" />
      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}>
        <AppCard style={{ padding: spacing.md, marginBottom: spacing.md, gap: spacing.xs }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold }}>{customer?.name ?? 'Customer'}</Text>
            <StatusBadge status={STATUS_BADGES[so.status]} label={STATUS_LABELS[so.status]} />
          </View>
          <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>Ordered {fmtShortDate(so.order_date)}</Text>
          {so.memo ? <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption, marginTop: spacing.xs }}>{so.memo}</Text> : null}
        </AppCard>

        <AppCard style={{ padding: 0, marginBottom: spacing.md }}>
          {so.lines.map((line, i) => {
            const item = itemsQuery.data?.find(it => it.id === line.inventory_item_id);
            return (
              <View key={line.id} style={[styles.lineRow, i !== so.lines.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.app.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.app.foreground }} numberOfLines={1}>{line.description ?? item?.name ?? item?.sku ?? 'Item'}</Text>
                  <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>{fmtMoney(line.quantity)} × ${fmtMoney(line.unit_price)}</Text>
                </View>
                <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium }}>
                  ${fmtMoney(String(parseFloat(line.quantity) * parseFloat(line.unit_price)))}
                </Text>
              </View>
            );
          })}
          <View style={[styles.lineRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.app.border }]}>
            <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.bold, flex: 1 }}>Total</Text>
            <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.bold }}>${fmtMoney(String(total))}</Text>
          </View>
        </AppCard>

        {canAct && so.status !== 'fulfilled' && so.status !== 'void' ? (
          <View style={{ gap: spacing.sm }}>
            <AppButton onPress={handleFulfill}>Fulfill</AppButton>
            <AppButton variant="destructive" onPress={handleVoid}>Void sales order</AppButton>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  lineRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm },
});
