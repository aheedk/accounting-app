import { useState } from 'react';
import { View, StyleSheet, ScrollView, Pressable, Alert } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
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
import { AppSegmentedControl } from '../components/ui/AppSegmentedControl';
import { listShippingLabels, listSalesOrders, listInvoices, createShippingLabel, deleteShippingLabel, type ShippingLabel } from '../services/api';
import { pickErr } from '../services/apiClient';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { fmtMoney, fmtShortDate } from '../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../theme';

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function ShippingLabelsScreen() {
  const theme = useTheme<AppTheme>();
  const { activeBusinessId, businesses, user } = useAuth();
  const queryClient = useQueryClient();
  const effectiveRole = (businesses.find(b => b.id === activeBusinessId)?.role_override ?? user?.role ?? 'viewer') as Role;
  const canCreate = hasMinRole(effectiveRole, 'staff');
  const canDelete = hasMinRole(effectiveRole, 'accountant');

  const [creating, setCreating] = useState(false);
  const [carrier, setCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [shippedAt, setShippedAt] = useState(todayIso());
  const [cost, setCost] = useState('');
  const [notes, setNotes] = useState('');
  const [linkType, setLinkType] = useState<'sales_order' | 'invoice'>('sales_order');
  const [soId, setSoId] = useState<string | null>(null);
  const [soPickerOpen, setSoPickerOpen] = useState(false);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [invoicePickerOpen, setInvoicePickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const labelsQuery = useQuery({
    queryKey: ['shipping-labels', activeBusinessId],
    queryFn: () => listShippingLabels(activeBusinessId!),
    enabled: !!activeBusinessId,
  });
  const soQuery = useQuery({
    queryKey: ['sales-orders', activeBusinessId, undefined],
    queryFn: () => listSalesOrders(activeBusinessId!),
    enabled: !!activeBusinessId, staleTime: 60_000,
  });
  const invoicesQuery = useQuery({
    queryKey: ['invoices', activeBusinessId],
    queryFn: () => listInvoices(activeBusinessId!),
    enabled: !!activeBusinessId, staleTime: 60_000,
  });

  const so = soQuery.data?.find(s => s.id === soId);
  const invoice = invoicesQuery.data?.find(i => i.id === invoiceId);

  async function handleSave() {
    if (!carrier.trim() || !trackingNumber.trim()) { setError('Carrier and tracking number are required.'); return; }
    // The backend requires a link to either an invoice or a sales order.
    if (linkType === 'sales_order' && !soId) { setError('Pick a sales order to link this label to.'); return; }
    if (linkType === 'invoice' && !invoiceId) { setError('Pick an invoice to link this label to.'); return; }
    setSaving(true);
    setError(null);
    try {
      await createShippingLabel(activeBusinessId!, {
        carrier: carrier.trim(), tracking_number: trackingNumber.trim(), shipped_at: shippedAt,
        sales_order_id: linkType === 'sales_order' ? soId : null,
        invoice_id: linkType === 'invoice' ? invoiceId : null,
        cost: cost || null, notes: notes || null,
      });
      await queryClient.invalidateQueries({ queryKey: ['shipping-labels'] });
      setCreating(false);
      setCarrier(''); setTrackingNumber(''); setCost(''); setNotes(''); setSoId(null); setInvoiceId(null);
    } catch (e) {
      setError(pickErr(e));
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(label: ShippingLabel) {
    Alert.alert('Delete this shipping label?', `Tracking ${label.tracking_number} will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteShippingLabel(activeBusinessId!, label.id);
              await queryClient.invalidateQueries({ queryKey: ['shipping-labels'] });
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
      <AppHeader title="Shipping Labels" />
      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}>
        {canCreate ? (
          creating ? (
            <AppCard style={{ padding: spacing.md, marginBottom: spacing.md, gap: spacing.sm }}>
              <AppTextInput label="Carrier" value={carrier} onChangeText={setCarrier} placeholder="e.g. UPS, FedEx, USPS" />
              <AppTextInput label="Tracking number" value={trackingNumber} onChangeText={setTrackingNumber} />
              <DateField label="Shipped on" value={shippedAt} onChange={setShippedAt} />

              <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium, fontSize: typeScale.label, marginBottom: 4 }}>Linked to</Text>
              <AppSegmentedControl
                value={linkType}
                onChange={setLinkType}
                options={[{ value: 'sales_order', label: 'Sales order' }, { value: 'invoice', label: 'Invoice' }]}
              />

              {linkType === 'sales_order' ? (
                <>
                  <PickerField label="Sales order" value={so?.so_number ?? null} onPress={() => setSoPickerOpen(true)} />
                  <SearchablePicker
                    visible={soPickerOpen} onDismiss={() => setSoPickerOpen(false)} title="Pick a sales order"
                    options={(soQuery.data ?? []).map(s => ({ id: s.id, label: s.so_number }))} onSelect={setSoId}
                  />
                </>
              ) : (
                <>
                  <PickerField label="Invoice" value={invoice?.invoice_number ?? null} onPress={() => setInvoicePickerOpen(true)} />
                  <SearchablePicker
                    visible={invoicePickerOpen} onDismiss={() => setInvoicePickerOpen(false)} title="Pick an invoice"
                    options={(invoicesQuery.data ?? []).map(i => ({ id: i.id, label: i.invoice_number }))} onSelect={setInvoiceId}
                  />
                </>
              )}
              <AppTextInput
                label="Cost" value={cost} onChangeText={v => setCost(v.replace(/[^0-9.]/g, ''))}
                keyboardType="decimal-pad" left={<Text style={{ color: theme.app.mutedForeground }}>$</Text>}
              />
              <AppTextInput label="Notes" value={notes} onChangeText={setNotes} />
              {error ? <Text style={{ color: theme.app.destructive }}>{error}</Text> : null}
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <AppButton variant="outline" onPress={() => setCreating(false)} style={{ flex: 1 }}>Cancel</AppButton>
                <AppButton onPress={() => void handleSave()} loading={saving} style={{ flex: 1 }}>Save</AppButton>
              </View>
            </AppCard>
          ) : (
            <AppButton onPress={() => setCreating(true)} style={{ marginBottom: spacing.md }}>New Shipping Label</AppButton>
          )
        ) : null}

        {labelsQuery.isLoading ? (
          <LoadingIndicator />
        ) : labelsQuery.error ? (
          <ErrorState onRetry={() => void labelsQuery.refetch()} />
        ) : !labelsQuery.data || labelsQuery.data.length === 0 ? (
          <EmptyState icon="truck-outline" message="No shipping labels yet." />
        ) : (
          <AppCard style={{ padding: 0 }}>
            {labelsQuery.data.map((label, i) => (
              <View
                key={label.id}
                style={[styles.row, i !== labelsQuery.data!.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.app.border }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium }} numberOfLines={1}>{label.carrier} — {label.tracking_number}</Text>
                  <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }} numberOfLines={1}>
                    {fmtShortDate(label.shipped_at)}{label.so_number ? ` · ${label.so_number}` : ''}{label.invoice_number ? ` · ${label.invoice_number}` : ''}
                    {label.cost ? ` · $${fmtMoney(label.cost)}` : ''}
                  </Text>
                </View>
                {canDelete ? (
                  <Pressable onPress={() => handleDelete(label)} hitSlop={8} style={{ marginLeft: spacing.sm }}>
                    <MaterialCommunityIcons name="trash-can-outline" size={18} color={theme.app.destructive} />
                  </Pressable>
                ) : null}
              </View>
            ))}
          </AppCard>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
