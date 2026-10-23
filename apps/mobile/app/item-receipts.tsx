import { useState } from 'react';
import { View, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { hasMinRole, type Role } from '@accounting/shared';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { AppCard } from '../components/ui/AppCard';
import { AppButton } from '../components/ui/AppButton';
import { AppTextInput } from '../components/ui/AppTextInput';
import { PickerField } from '../components/PickerField';
import { SearchablePicker } from '../components/SearchablePicker';
import { DateField } from '../components/DateField';
import { listItemReceipts, listPurchaseOrders, createItemReceipt, type ItemReceipt } from '../services/api';
import { pickErr } from '../services/apiClient';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { fmtShortDate } from '../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../theme';

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function ItemReceiptsScreen() {
  const theme = useTheme<AppTheme>();
  const { activeBusinessId, businesses, user } = useAuth();
  const queryClient = useQueryClient();
  const effectiveRole = (businesses.find(b => b.id === activeBusinessId)?.role_override ?? user?.role ?? 'viewer') as Role;
  const canCreate = hasMinRole(effectiveRole, 'staff');

  const { poId: poIdParam } = useLocalSearchParams<{ poId?: string }>();
  const [creating, setCreating] = useState(!!poIdParam);
  const [poId, setPoId] = useState<string | null>(poIdParam ?? null);
  const [poPickerOpen, setPoPickerOpen] = useState(false);
  const [receiptDate, setReceiptDate] = useState(todayIso());
  const [memo, setMemo] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const receiptsQuery = useQuery({
    queryKey: ['item-receipts', activeBusinessId],
    queryFn: () => listItemReceipts(activeBusinessId!),
    enabled: !!activeBusinessId,
  });
  const poQuery = useQuery({
    queryKey: ['purchase-orders', activeBusinessId, undefined],
    queryFn: () => listPurchaseOrders(activeBusinessId!),
    enabled: !!activeBusinessId, staleTime: 60_000,
  });

  // Matches web's canReceive gate: any PO not yet void/received/closed can
  // still take a receipt (draft included — there's no separate "send" step).
  const openPOs = (poQuery.data ?? []).filter(po => po.status !== 'void' && po.status !== 'received' && po.status !== 'closed');
  const po = poQuery.data?.find(p => p.id === poId);

  async function handleSave() {
    if (!poId) { setError('Pick a purchase order.'); return; }
    setSaving(true);
    setError(null);
    try {
      await createItemReceipt(activeBusinessId!, { purchase_order_id: poId, receipt_date: receiptDate, memo: memo || null });
      await queryClient.invalidateQueries({ queryKey: ['item-receipts'] });
      await queryClient.invalidateQueries({ queryKey: ['purchase-order', activeBusinessId, poId] });
      await queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      setCreating(false);
      setPoId(null);
      setMemo('');
    } catch (e) {
      setError(pickErr(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Item Receipts" />
      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}>
        {canCreate ? (
          creating ? (
            <AppCard style={{ padding: spacing.md, marginBottom: spacing.md, gap: spacing.sm }}>
              <PickerField label="Purchase order" value={po ? po.po_number : null} onPress={() => setPoPickerOpen(true)} />
              <SearchablePicker
                visible={poPickerOpen} onDismiss={() => setPoPickerOpen(false)} title="Pick a purchase order"
                options={openPOs.map(p => ({ id: p.id, label: p.po_number }))} onSelect={setPoId}
              />
              <DateField label="Receipt date" value={receiptDate} onChange={setReceiptDate} />
              <AppTextInput label="Memo" value={memo} onChangeText={setMemo} />
              {error ? <Text style={{ color: theme.app.destructive }}>{error}</Text> : null}
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <AppButton variant="outline" onPress={() => setCreating(false)} style={{ flex: 1 }}>Cancel</AppButton>
                <AppButton onPress={() => void handleSave()} loading={saving} style={{ flex: 1 }}>Save</AppButton>
              </View>
            </AppCard>
          ) : (
            <AppButton onPress={() => setCreating(true)} style={{ marginBottom: spacing.md }}>New Item Receipt</AppButton>
          )
        ) : null}

        {receiptsQuery.isLoading ? (
          <LoadingIndicator />
        ) : receiptsQuery.error ? (
          <ErrorState onRetry={() => void receiptsQuery.refetch()} />
        ) : !receiptsQuery.data || receiptsQuery.data.length === 0 ? (
          <EmptyState icon="package-down" message="No item receipts yet." />
        ) : (
          <AppCard style={{ padding: 0 }}>
            {receiptsQuery.data.map((r: ItemReceipt, i) => {
              const sourcePo = poQuery.data?.find(p => p.id === r.purchase_order_id);
              return (
                <Pressable
                  key={r.id}
                  onPress={() => sourcePo && router.push({ pathname: '/purchase-order/[id]', params: { id: sourcePo.id } })}
                  style={[styles.row, i !== receiptsQuery.data!.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.app.border }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium }} numberOfLines={1}>
                      {sourcePo?.po_number ?? 'Purchase order'}
                    </Text>
                    {r.memo ? <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }} numberOfLines={1}>{r.memo}</Text> : null}
                  </View>
                  <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>{fmtShortDate(r.receipt_date)}</Text>
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
