import { View, StyleSheet, ScrollView, Alert } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { hasMinRole, type Role } from '@accounting/shared';
import { useAuth } from '../../hooks/useAuth';
import { AppHeader } from '../../components/AppHeader';
import { AppCard } from '../../components/ui/AppCard';
import { AppButton } from '../../components/ui/AppButton';
import { StatusBadge, type BadgeStatus } from '../../components/ui/StatusBadge';
import { getPurchaseOrder, listVendors, listInventoryItems, voidPurchaseOrder, type PurchaseOrderStatus } from '../../services/api';
import { pickErr } from '../../services/apiClient';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { ErrorState } from '../../components/ErrorState';
import { fmtMoney, fmtShortDate } from '../../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../../theme';

const STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  draft: 'Draft', sent: 'Sent', received: 'Received', closed: 'Closed', void: 'Void',
};
const STATUS_BADGES: Record<PurchaseOrderStatus, BadgeStatus> = {
  draft: 'gray', sent: 'blue', received: 'green', closed: 'gray', void: 'red',
};

export default function PurchaseOrderDetailScreen() {
  const theme = useTheme<AppTheme>();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { activeBusinessId, businesses, user } = useAuth();
  const queryClient = useQueryClient();
  const effectiveRole = (businesses.find(b => b.id === activeBusinessId)?.role_override ?? user?.role ?? 'viewer') as Role;
  const canVoid = hasMinRole(effectiveRole, 'accountant');
  const canReceive = hasMinRole(effectiveRole, 'staff');

  const query = useQuery({
    queryKey: ['purchase-order', activeBusinessId, id],
    queryFn: () => getPurchaseOrder(activeBusinessId!, id!),
    enabled: !!activeBusinessId && !!id,
  });
  const vendorsQuery = useQuery({
    queryKey: ['vendors', activeBusinessId],
    queryFn: () => listVendors(activeBusinessId!),
    enabled: !!activeBusinessId, staleTime: 5 * 60_000,
  });
  const itemsQuery = useQuery({
    queryKey: ['inventory-items', activeBusinessId],
    queryFn: () => listInventoryItems(activeBusinessId!, { include_inactive: true }),
    enabled: !!activeBusinessId, staleTime: 5 * 60_000,
  });

  function handleVoid() {
    Alert.alert('Void this purchase order?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Void', style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await voidPurchaseOrder(activeBusinessId!, id!);
              await queryClient.invalidateQueries({ queryKey: ['purchase-order', activeBusinessId, id] });
              await queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
            } catch (e) {
              Alert.alert("Couldn't void", pickErr(e));
            }
          })();
        },
      },
    ]);
  }

  if (query.isLoading) {
    return <View style={{ flex: 1, backgroundColor: theme.colors.background }}><AppHeader title="Purchase Order" leading="back" /><LoadingIndicator /></View>;
  }
  if (query.error || !query.data) {
    return <View style={{ flex: 1, backgroundColor: theme.colors.background }}><AppHeader title="Purchase Order" leading="back" /><ErrorState onRetry={() => void query.refetch()} /></View>;
  }

  const po = query.data;
  const vendor = vendorsQuery.data?.find(v => v.id === po.vendor_id);
  const total = po.lines.reduce((sum, l) => sum + parseFloat(l.quantity) * parseFloat(l.unit_cost), 0);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title={po.po_number} leading="back" />
      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}>
        <AppCard style={{ padding: spacing.md, marginBottom: spacing.md, gap: spacing.xs }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold }}>{vendor?.name ?? 'Vendor'}</Text>
            <StatusBadge status={STATUS_BADGES[po.status]} label={STATUS_LABELS[po.status]} />
          </View>
          <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>
            Ordered {fmtShortDate(po.order_date)}{po.expected_delivery_date ? ` · Expected ${fmtShortDate(po.expected_delivery_date)}` : ''}
          </Text>
          {po.memo ? <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption, marginTop: spacing.xs }}>{po.memo}</Text> : null}
        </AppCard>

        <AppCard style={{ padding: 0, marginBottom: spacing.md }}>
          {po.lines.map((line, i) => {
            const item = itemsQuery.data?.find(it => it.id === line.inventory_item_id);
            return (
              <View key={line.id} style={[styles.lineRow, i !== po.lines.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.app.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.app.foreground }} numberOfLines={1}>{line.description ?? item?.name ?? item?.sku ?? 'Item'}</Text>
                  <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>{fmtMoney(line.quantity)} × ${fmtMoney(line.unit_cost)}</Text>
                </View>
                <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium }}>
                  ${fmtMoney(String(parseFloat(line.quantity) * parseFloat(line.unit_cost)))}
                </Text>
              </View>
            );
          })}
          <View style={[styles.lineRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.app.border }]}>
            <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.bold, flex: 1 }}>Total</Text>
            <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.bold }}>${fmtMoney(String(total))}</Text>
          </View>
        </AppCard>

        <View style={{ gap: spacing.sm }}>
          {canReceive && po.status !== 'void' && po.status !== 'received' && po.status !== 'closed' ? (
            <AppButton onPress={() => router.push({ pathname: '/item-receipts', params: { poId: po.id } })}>Receive</AppButton>
          ) : null}
          {canVoid && po.status !== 'void' && po.status !== 'received' ? (
            <AppButton variant="destructive" onPress={handleVoid}>Void purchase order</AppButton>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  lineRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm },
});
