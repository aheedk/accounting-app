import { useState } from 'react';
import { View, ScrollView, StyleSheet, Pressable } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../hooks/useAuth';
import { AppHeader } from '../../components/AppHeader';
import { AppButton } from '../../components/ui/AppButton';
import { AppTextInput } from '../../components/ui/AppTextInput';
import { PickerField } from '../../components/PickerField';
import { SearchablePicker } from '../../components/SearchablePicker';
import { DateField } from '../../components/DateField';
import { listVendors, listInventoryItems, createPurchaseOrder, type PurchaseOrderLineInput } from '../../services/api';
import { pickErr } from '../../services/apiClient';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { fmtMoney } from '../../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../../theme';

const todayIso = () => new Date().toISOString().slice(0, 10);

type DraftLine = { key: string; inventory_item_id: string | null; quantity: string; unit_cost: string };

export default function NewPurchaseOrderScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { activeBusinessId } = useAuth();
  const queryClient = useQueryClient();

  const [vendorId, setVendorId] = useState<string | null>(null);
  const [vendorPickerOpen, setVendorPickerOpen] = useState(false);
  const [orderDate, setOrderDate] = useState(todayIso());
  const [expectedDate, setExpectedDate] = useState('');
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([{ key: '1', inventory_item_id: null, quantity: '', unit_cost: '' }]);
  const [itemPickerFor, setItemPickerFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const vendorsQuery = useQuery({
    queryKey: ['vendors', activeBusinessId],
    queryFn: () => listVendors(activeBusinessId!),
    enabled: !!activeBusinessId, staleTime: 5 * 60_000,
  });
  const itemsQuery = useQuery({
    queryKey: ['inventory-items', activeBusinessId],
    queryFn: () => listInventoryItems(activeBusinessId!),
    enabled: !!activeBusinessId, staleTime: 5 * 60_000,
  });

  const vendor = vendorsQuery.data?.find(v => v.id === vendorId);

  function addLine() {
    setLines(prev => [...prev, { key: String(Date.now()), inventory_item_id: null, quantity: '', unit_cost: '' }]);
  }
  function removeLine(key: string) {
    setLines(prev => prev.filter(l => l.key !== key));
  }
  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)));
  }

  async function handleSave() {
    if (!vendorId) { setError('Pick a vendor.'); return; }
    const validLines = lines.filter(l => l.inventory_item_id && parseFloat(l.quantity) > 0 && parseFloat(l.unit_cost) >= 0);
    if (validLines.length === 0) { setError('Add at least one line with an item, quantity, and cost.'); return; }
    setError(null);
    setSaving(true);
    try {
      const lineInputs: PurchaseOrderLineInput[] = validLines.map(l => ({
        inventory_item_id: l.inventory_item_id!, quantity: l.quantity, unit_cost: l.unit_cost,
      }));
      const created = await createPurchaseOrder(activeBusinessId!, {
        vendor_id: vendorId, order_date: orderDate,
        expected_delivery_date: expectedDate || null, memo: memo || null, lines: lineInputs,
      });
      await queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      router.replace({ pathname: '/purchase-order/[id]', params: { id: created.id } });
    } catch (e) {
      setError(pickErr(e));
    } finally {
      setSaving(false);
    }
  }

  if (vendorsQuery.isLoading || itemsQuery.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <AppHeader title="New Purchase Order" leading="back" />
        <LoadingIndicator />
      </View>
    );
  }

  const total = lines.reduce((sum, l) => sum + (parseFloat(l.quantity) || 0) * (parseFloat(l.unit_cost) || 0), 0);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="New Purchase Order" leading="back" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <PickerField label="Vendor" value={vendor?.name ?? null} onPress={() => setVendorPickerOpen(true)} />
        <SearchablePicker
          visible={vendorPickerOpen} onDismiss={() => setVendorPickerOpen(false)} title="Pick a vendor"
          options={(vendorsQuery.data ?? []).map(v => ({ id: v.id, label: v.name }))} onSelect={setVendorId}
        />

        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}><DateField label="Order date" value={orderDate} onChange={setOrderDate} /></View>
          <View style={{ flex: 1 }}><DateField label="Expected delivery" value={expectedDate} onChange={setExpectedDate} /></View>
        </View>

        <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold, fontSize: typeScale.h3, marginTop: spacing.md, marginBottom: spacing.sm }}>Lines</Text>
        {lines.map(line => {
          const item = itemsQuery.data?.find(it => it.id === line.inventory_item_id);
          return (
            <View key={line.key} style={[styles.lineCard, { borderColor: theme.app.border }]}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <PickerField label="Item" value={item ? `${item.sku} — ${item.name}` : null} onPress={() => setItemPickerFor(line.key)} />
                </View>
                {lines.length > 1 ? (
                  <Pressable onPress={() => removeLine(line.key)} hitSlop={8} style={{ marginBottom: spacing.md }}>
                    <MaterialCommunityIcons name="close-circle-outline" size={22} color={theme.app.destructive} />
                  </Pressable>
                ) : null}
              </View>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <AppTextInput
                  label="Quantity" value={line.quantity} onChangeText={v => updateLine(line.key, { quantity: v.replace(/[^0-9.]/g, '') })}
                  keyboardType="decimal-pad" containerStyle={{ flex: 1 }}
                />
                <AppTextInput
                  label="Unit cost" value={line.unit_cost} onChangeText={v => updateLine(line.key, { unit_cost: v.replace(/[^0-9.]/g, '') })}
                  keyboardType="decimal-pad" left={<Text style={{ color: theme.app.mutedForeground }}>$</Text>} containerStyle={{ flex: 1 }}
                />
              </View>
            </View>
          );
        })}
        <SearchablePicker
          visible={!!itemPickerFor} onDismiss={() => setItemPickerFor(null)} title="Pick an item"
          options={(itemsQuery.data ?? []).filter(it => it.is_active).map(it => ({ id: it.id, label: `${it.sku} — ${it.name}` }))}
          onSelect={id => { if (itemPickerFor) updateLine(itemPickerFor, { inventory_item_id: id }); }}
        />
        <AppButton variant="outline" onPress={addLine} style={{ marginBottom: spacing.md }}>Add line</AppButton>

        <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold, textAlign: 'right', marginBottom: spacing.md }}>
          Total: ${fmtMoney(String(total))}
        </Text>

        <AppTextInput
          label="Memo" value={memo} onChangeText={setMemo} multiline style={{ minHeight: 64, textAlignVertical: 'top' }}
          containerStyle={{ marginBottom: spacing.lg }}
        />

        {error ? <Text style={{ color: theme.app.destructive, marginBottom: spacing.sm }}>{error}</Text> : null}
      </ScrollView>

      <View style={[styles.footer, { borderColor: theme.app.border, backgroundColor: theme.app.surface, paddingBottom: insets.bottom + spacing.sm }]}>
        <AppButton variant="outline" onPress={() => router.back()}>Cancel</AppButton>
        <AppButton onPress={() => void handleSave()} loading={saving} style={{ flex: 1 }}>Create</AppButton>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md },
  lineCard: { borderWidth: 1, borderRadius: 8, padding: spacing.sm, marginBottom: spacing.sm },
  footer: {
    flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
