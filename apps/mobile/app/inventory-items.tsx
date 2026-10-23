import { useMemo, useState } from 'react';
import { View, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { hasMinRole, type Role } from '@accounting/shared';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { AppCard } from '../components/ui/AppCard';
import { AppButton } from '../components/ui/AppButton';
import { AppTextInput } from '../components/ui/AppTextInput';
import { AppChip } from '../components/ui/AppChip';
import { AppMenu, AppMenuItem } from '../components/ui/AppMenu';
import { StatusBadge } from '../components/ui/StatusBadge';
import { DateField } from '../components/DateField';
import { PickerField } from '../components/PickerField';
import { SearchablePicker } from '../components/SearchablePicker';
import {
  listChartOfAccounts, listInventoryItems, createInventoryItem, updateInventoryItem, deleteInventoryItem,
  getInventoryItem, adjustInventoryStock,
  type InventoryItem, type StockMovementReason,
} from '../services/api';
import { pickErr } from '../services/apiClient';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { fmtMoney, fmtShortDate } from '../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../theme';

const todayIso = () => new Date().toISOString().slice(0, 10);
const REASON_LABELS: Record<StockMovementReason, string> = {
  adjustment: 'Adjustment', opening_balance: 'Opening balance', manual_in: 'Manual in',
  manual_out: 'Manual out', write_off: 'Write off',
};

export default function InventoryItemsScreen() {
  const theme = useTheme<AppTheme>();
  const { activeBusinessId, businesses, user } = useAuth();
  const queryClient = useQueryClient();
  const effectiveRole = (businesses.find(b => b.id === activeBusinessId)?.role_override ?? user?.role ?? 'viewer') as Role;
  const canEdit = hasMinRole(effectiveRole, 'staff');
  const canDelete = hasMinRole(effectiveRole, 'accountant');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const itemsQuery = useQuery({
    queryKey: ['inventory-items', activeBusinessId],
    queryFn: () => listInventoryItems(activeBusinessId!, { include_inactive: true }),
    enabled: !!activeBusinessId,
  });

  if (selectedId) {
    return (
      <ItemDetail
        businessId={activeBusinessId!} itemId={selectedId} canEdit={canEdit} canDelete={canDelete} theme={theme}
        onBack={() => setSelectedId(null)}
        onDeleted={() => { setSelectedId(null); void queryClient.invalidateQueries({ queryKey: ['inventory-items'] }); }}
      />
    );
  }

  if (creating) {
    return (
      <ItemForm
        businessId={activeBusinessId!} theme={theme}
        onCancel={() => setCreating(false)}
        onCreated={id => { setCreating(false); void queryClient.invalidateQueries({ queryKey: ['inventory-items'] }); setSelectedId(id); }}
      />
    );
  }

  function handleDelete(item: InventoryItem) {
    Alert.alert('Delete this item?', `"${item.name}" will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteInventoryItem(activeBusinessId!, item.id);
              await queryClient.invalidateQueries({ queryKey: ['inventory-items'] });
            } catch (e) {
              Alert.alert('Could not delete', pickErr(e));
            }
          })();
        },
      },
    ]);
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Inventory" />
      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}>
        {canEdit ? <AppButton onPress={() => setCreating(true)} style={{ marginBottom: spacing.md }}>New Item</AppButton> : null}

        {itemsQuery.isLoading ? (
          <LoadingIndicator />
        ) : itemsQuery.error ? (
          <ErrorState onRetry={() => void itemsQuery.refetch()} />
        ) : !itemsQuery.data || itemsQuery.data.length === 0 ? (
          <EmptyState icon="package-variant-closed" message="No inventory items yet." />
        ) : (
          <AppCard style={{ padding: 0 }}>
            {itemsQuery.data.map((item, i) => (
              <Pressable
                key={item.id}
                onPress={() => setSelectedId(item.id)}
                style={[styles.listRow, i !== itemsQuery.data!.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.app.border }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium }} numberOfLines={1}>{item.sku} — {item.name}</Text>
                  <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>
                    Qty {fmtMoney(item.quantity_on_hand)} {item.unit_of_measure}
                  </Text>
                </View>
                {!item.is_active ? <StatusBadge status="gray" label="Inactive" /> : null}
                {canDelete ? (
                  <Pressable onPress={() => handleDelete(item)} hitSlop={8} style={{ marginLeft: spacing.sm }}>
                    <MaterialCommunityIcons name="trash-can-outline" size={18} color={theme.app.destructive} />
                  </Pressable>
                ) : null}
              </Pressable>
            ))}
          </AppCard>
        )}
      </ScrollView>
    </View>
  );
}

function ItemForm({
  businessId, theme, onCancel, onCreated,
}: { businessId: string; theme: AppTheme; onCancel: () => void; onCreated: (id: string) => void }) {
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [unitOfMeasure, setUnitOfMeasure] = useState('each');
  const [purchaseCost, setPurchaseCost] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [incomeAccountId, setIncomeAccountId] = useState<string | null>(null);
  const [expenseAccountId, setExpenseAccountId] = useState<string | null>(null);
  const [assetAccountId, setAssetAccountId] = useState<string | null>(null);
  const [incomePickerOpen, setIncomePickerOpen] = useState(false);
  const [expensePickerOpen, setExpensePickerOpen] = useState(false);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accountsQuery = useQuery({
    queryKey: ['coa', businessId],
    queryFn: () => listChartOfAccounts(businessId),
    enabled: !!businessId, staleTime: 5 * 60_000,
  });
  const revenueAccounts = (accountsQuery.data ?? []).filter(a => a.account_type === 'revenue' && a.is_active);
  const expenseAccounts = (accountsQuery.data ?? []).filter(a => a.account_type === 'expense' && a.is_active);
  const assetAccounts = (accountsQuery.data ?? []).filter(a => a.account_type === 'asset' && a.is_active);
  const incomeAccount = revenueAccounts.find(a => a.id === incomeAccountId);
  const expenseAccount = expenseAccounts.find(a => a.id === expenseAccountId);
  const assetAccount = assetAccounts.find(a => a.id === assetAccountId);

  async function handleSave() {
    if (!sku.trim() || !name.trim()) { setError('SKU and name are required.'); return; }
    setSaving(true);
    setError(null);
    try {
      const created = await createInventoryItem(businessId, {
        sku: sku.trim(), name: name.trim(), unit_of_measure: unitOfMeasure.trim() || 'each',
        purchase_cost: purchaseCost || null, sale_price: salePrice || null,
        income_account_id: incomeAccountId, expense_account_id: expenseAccountId, inventory_asset_account_id: assetAccountId,
      });
      onCreated(created.id);
    } catch (e) {
      setError(pickErr(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="New Item" />
      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}>
        <Pressable onPress={onCancel} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: spacing.md }}>
          <MaterialCommunityIcons name="chevron-left" size={18} color={theme.app.primary} />
          <Text style={{ color: theme.app.primary, fontFamily: fontFamily.medium }}>All items</Text>
        </Pressable>

        <AppTextInput label="SKU" value={sku} onChangeText={setSku} autoCapitalize="characters" containerStyle={{ marginBottom: spacing.md }} />
        <AppTextInput label="Name" value={name} onChangeText={setName} containerStyle={{ marginBottom: spacing.md }} />
        <AppTextInput label="Unit of measure" value={unitOfMeasure} onChangeText={setUnitOfMeasure} containerStyle={{ marginBottom: spacing.md }} />
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
          <AppTextInput
            label="Purchase cost" value={purchaseCost} onChangeText={v => setPurchaseCost(v.replace(/[^0-9.]/g, ''))}
            keyboardType="decimal-pad" left={<Text style={{ color: theme.app.mutedForeground }}>$</Text>} containerStyle={{ flex: 1 }}
          />
          <AppTextInput
            label="Sale price" value={salePrice} onChangeText={v => setSalePrice(v.replace(/[^0-9.]/g, ''))}
            keyboardType="decimal-pad" left={<Text style={{ color: theme.app.mutedForeground }}>$</Text>} containerStyle={{ flex: 1 }}
          />
        </View>

        {/* These three are what let a purchase/sale of this item post to the
            ledger — an item receipt refuses to post without an asset
            account set (confirmed live: PRECONDITION_FAILED without one). */}
        <PickerField label="Income account" value={incomeAccount ? `${incomeAccount.code} — ${incomeAccount.name}` : null} onPress={() => setIncomePickerOpen(true)} />
        <SearchablePicker
          visible={incomePickerOpen} onDismiss={() => setIncomePickerOpen(false)} title="Pick an income account"
          options={revenueAccounts.map(a => ({ id: a.id, label: `${a.code} — ${a.name}` }))} onSelect={setIncomeAccountId}
        />
        <PickerField label="Expense account" value={expenseAccount ? `${expenseAccount.code} — ${expenseAccount.name}` : null} onPress={() => setExpensePickerOpen(true)} />
        <SearchablePicker
          visible={expensePickerOpen} onDismiss={() => setExpensePickerOpen(false)} title="Pick an expense account"
          options={expenseAccounts.map(a => ({ id: a.id, label: `${a.code} — ${a.name}` }))} onSelect={setExpenseAccountId}
        />
        <PickerField label="Inventory asset account" value={assetAccount ? `${assetAccount.code} — ${assetAccount.name}` : null} onPress={() => setAssetPickerOpen(true)} />
        <SearchablePicker
          visible={assetPickerOpen} onDismiss={() => setAssetPickerOpen(false)} title="Pick an inventory asset account"
          options={assetAccounts.map(a => ({ id: a.id, label: `${a.code} — ${a.name}` }))} onSelect={setAssetAccountId}
        />

        {error ? <Text style={{ color: theme.app.destructive, marginBottom: spacing.sm }}>{error}</Text> : null}
        <AppButton onPress={() => void handleSave()} loading={saving}>Create</AppButton>
      </ScrollView>
    </View>
  );
}

function ItemDetail({
  businessId, itemId, canEdit, canDelete, theme, onBack, onDeleted,
}: {
  businessId: string; itemId: string; canEdit: boolean; canDelete: boolean; theme: AppTheme;
  onBack: () => void; onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [adjustQty, setAdjustQty] = useState('');
  const [adjustReason, setAdjustReason] = useState<StockMovementReason>('adjustment');
  const [adjustMemo, setAdjustMemo] = useState('');
  const [adjustDate, setAdjustDate] = useState(todayIso());
  const [reasonMenuOpen, setReasonMenuOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const itemQuery = useQuery({
    queryKey: ['inventory-item', businessId, itemId],
    queryFn: () => getInventoryItem(businessId, itemId),
    enabled: !!businessId,
  });
  const accountsQuery = useQuery({
    queryKey: ['coa', businessId],
    queryFn: () => listChartOfAccounts(businessId),
    enabled: !!businessId, staleTime: 5 * 60_000,
  });
  const assetAccounts = (accountsQuery.data ?? []).filter(a => a.account_type === 'asset' && a.is_active);
  const assetAccount = assetAccounts.find(a => a.id === itemQuery.data?.inventory_asset_account_id);

  async function handleSetAssetAccount(accountId: string) {
    try {
      await updateInventoryItem(businessId, itemId, { inventory_asset_account_id: accountId });
      await queryClient.invalidateQueries({ queryKey: ['inventory-item', businessId, itemId] });
    } catch (e) {
      Alert.alert("Couldn't set asset account", pickErr(e));
    }
  }

  async function handleAdjust() {
    if (!(parseFloat(adjustQty) !== 0) || Number.isNaN(parseFloat(adjustQty))) { Alert.alert('Enter a non-zero quantity.'); return; }
    setSaving(true);
    try {
      await adjustInventoryStock(businessId, itemId, {
        movement_date: adjustDate, quantity_delta: adjustQty, reason: adjustReason, memo: adjustMemo || null,
      });
      await queryClient.invalidateQueries({ queryKey: ['inventory-item', businessId, itemId] });
      await queryClient.invalidateQueries({ queryKey: ['inventory-items'] });
      setAdjusting(false);
      setAdjustQty('');
      setAdjustMemo('');
    } catch (e) {
      Alert.alert("Couldn't adjust stock", pickErr(e));
    } finally {
      setSaving(false);
    }
  }

  function handleToggleActive() {
    if (!itemQuery.data) return;
    void (async () => {
      try {
        await updateInventoryItem(businessId, itemId, { is_active: !itemQuery.data!.is_active });
        await queryClient.invalidateQueries({ queryKey: ['inventory-item', businessId, itemId] });
        await queryClient.invalidateQueries({ queryKey: ['inventory-items'] });
      } catch (e) {
        Alert.alert("Couldn't update item", pickErr(e));
      }
    })();
  }

  function handleDelete() {
    if (!itemQuery.data) return;
    Alert.alert('Delete this item?', `"${itemQuery.data.name}" will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteInventoryItem(businessId, itemId);
              onDeleted();
            } catch (e) {
              Alert.alert('Could not delete', pickErr(e));
            }
          })();
        },
      },
    ]);
  }

  if (itemQuery.isLoading) {
    return <View style={{ flex: 1, backgroundColor: theme.colors.background }}><AppHeader title="Item" /><LoadingIndicator /></View>;
  }
  if (itemQuery.error || !itemQuery.data) {
    return <View style={{ flex: 1, backgroundColor: theme.colors.background }}><AppHeader title="Item" /><ErrorState onRetry={() => void itemQuery.refetch()} /></View>;
  }

  const item = itemQuery.data;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title={item.name} />
      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}>
        <Pressable onPress={onBack} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: spacing.md }}>
          <MaterialCommunityIcons name="chevron-left" size={18} color={theme.app.primary} />
          <Text style={{ color: theme.app.primary, fontFamily: fontFamily.medium }}>All items</Text>
        </Pressable>

        <AppCard style={{ padding: spacing.md, marginBottom: spacing.md, gap: spacing.xs }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: theme.app.mutedForeground }}>SKU</Text>
            <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium }}>{item.sku}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: theme.app.mutedForeground }}>On hand</Text>
            <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium }}>{fmtMoney(item.quantity_on_hand)} {item.unit_of_measure}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: theme.app.mutedForeground }}>Purchase cost</Text>
            <Text style={{ color: theme.app.foreground }}>${fmtMoney(item.purchase_cost ?? '0')}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: theme.app.mutedForeground }}>Sale price</Text>
            <Text style={{ color: theme.app.foreground }}>${fmtMoney(item.sale_price ?? '0')}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: theme.app.mutedForeground }}>Status</Text>
            <StatusBadge status={item.is_active ? 'green' : 'gray'} label={item.is_active ? 'Active' : 'Inactive'} />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: theme.app.mutedForeground }}>Inventory asset account</Text>
            {assetAccount ? (
              <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium }}>{assetAccount.code} — {assetAccount.name}</Text>
            ) : (
              <Text style={{ color: theme.app.destructive, fontFamily: fontFamily.medium }}>Not set</Text>
            )}
          </View>
          {canEdit ? (
            <AppButton variant="outline" onPress={() => setAssetPickerOpen(true)}>
              {assetAccount ? 'Change asset account' : 'Set asset account'}
            </AppButton>
          ) : null}
          <SearchablePicker
            visible={assetPickerOpen} onDismiss={() => setAssetPickerOpen(false)} title="Pick an inventory asset account"
            options={assetAccounts.map(a => ({ id: a.id, label: `${a.code} — ${a.name}` }))}
            onSelect={id => void handleSetAssetAccount(id)}
          />
          {canEdit ? (
            <AppButton variant="outline" onPress={handleToggleActive} style={{ marginTop: spacing.sm }}>
              {item.is_active ? 'Mark inactive' : 'Mark active'}
            </AppButton>
          ) : null}
          {canDelete ? (
            <AppButton variant="destructive" onPress={handleDelete} style={{ marginTop: spacing.xs }}>Delete item</AppButton>
          ) : null}
        </AppCard>

        {canEdit ? (
          adjusting ? (
            <AppCard style={{ padding: spacing.md, marginBottom: spacing.md, gap: spacing.sm }}>
              <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold }}>Adjust stock</Text>
              <DateField label="Movement date" value={adjustDate} onChange={setAdjustDate} />
              <AppTextInput
                label="Quantity (+/-)" value={adjustQty} onChangeText={v => setAdjustQty(v.replace(/[^0-9.-]/g, ''))}
                keyboardType="numbers-and-punctuation" placeholder="e.g. 10 or -5"
              />
              <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium, fontSize: typeScale.label }}>Reason</Text>
              <AppMenu
                visible={reasonMenuOpen} onDismiss={() => setReasonMenuOpen(false)}
                anchor={<AppChip icon="chevron-down" label={REASON_LABELS[adjustReason]} onPress={() => setReasonMenuOpen(true)} />}
              >
                {(Object.keys(REASON_LABELS) as StockMovementReason[]).map(r => (
                  <AppMenuItem key={r} title={REASON_LABELS[r]} onPress={() => { setAdjustReason(r); setReasonMenuOpen(false); }} />
                ))}
              </AppMenu>
              <AppTextInput label="Memo" value={adjustMemo} onChangeText={setAdjustMemo} />
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <AppButton variant="outline" onPress={() => setAdjusting(false)} style={{ flex: 1 }}>Cancel</AppButton>
                <AppButton onPress={() => void handleAdjust()} loading={saving} style={{ flex: 1 }}>Save</AppButton>
              </View>
            </AppCard>
          ) : (
            <AppButton variant="outline" onPress={() => setAdjusting(true)} style={{ marginBottom: spacing.md }}>Adjust stock</AppButton>
          )
        ) : null}

        <Text style={{ fontSize: typeScale.h3, fontFamily: fontFamily.semibold, color: theme.app.foreground, marginBottom: spacing.sm }}>Stock movements</Text>
        <AppCard style={{ padding: 0 }}>
          {item.stock_movements.length === 0 ? (
            <View style={{ padding: spacing.md }}><Text style={{ color: theme.app.mutedForeground }}>No movements yet.</Text></View>
          ) : (
            item.stock_movements.map((m, i) => {
              const delta = parseFloat(m.quantity_delta);
              return (
                <View key={m.id} style={[styles.movementRow, i !== item.stock_movements.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.app.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.app.foreground }}>{REASON_LABELS[m.reason]}</Text>
                    <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>
                      {fmtShortDate(m.movement_date)}{m.posted_by_name ? ` · ${m.posted_by_name}` : ''}{m.memo ? ` · ${m.memo}` : ''}
                    </Text>
                  </View>
                  <Text style={{ color: delta >= 0 ? theme.app.statusGreenFg : theme.app.statusRedFg, fontFamily: fontFamily.medium }}>
                    {delta >= 0 ? '+' : ''}{fmtMoney(m.quantity_delta)}
                  </Text>
                </View>
              );
            })
          )}
        </AppCard>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  listRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  movementRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm },
});
