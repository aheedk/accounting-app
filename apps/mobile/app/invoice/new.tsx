import { useEffect, useMemo, useState } from 'react';
import { View, ScrollView, StyleSheet, Pressable } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { hasMinRole, type Role } from '@accounting/shared';
import { useAuth } from '../../hooks/useAuth';
import { AppHeader } from '../../components/AppHeader';
import { AppButton } from '../../components/ui/AppButton';
import { AppTextInput } from '../../components/ui/AppTextInput';
import { PickerField } from '../../components/PickerField';
import { SearchablePicker } from '../../components/SearchablePicker';
import { DateField } from '../../components/DateField';
import {
  listCustomers, listChartOfAccounts, getNextInvoiceNumber, createInvoiceDraft, postInvoice,
  type InvoiceLineInput,
} from '../../services/api';
import { pickErr } from '../../services/apiClient';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { fmtMoney } from '../../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../../theme';

const todayIso = () => new Date().toISOString().slice(0, 10);
function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

type DraftLine = { key: string; description: string; quantity: string; unit_price: string; revenue_account_id: string | null };

export default function NewInvoiceScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { activeBusinessId, businesses, user } = useAuth();
  const queryClient = useQueryClient();
  // Business.default_invoice_terms_days lives in company settings
  // (getBusinessSettings), not the lightweight auth business list — net 30
  // is the same fallback used elsewhere in this app when that's unavailable.
  const defaultTermsDays = 30;
  // Matches web's useSaveAndPost: posting needs accountant+; everyone else
  // (staff can create invoices per the route's own requireMinRole('staff'))
  // always saves a draft for an accountant to post later.
  const effectiveRole = (businesses.find(b => b.id === activeBusinessId)?.role_override ?? user?.role ?? 'viewer') as Role;
  const canPost = hasMinRole(effectiveRole, 'accountant');

  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [issueDate, setIssueDate] = useState(todayIso());
  const [dueDate, setDueDate] = useState(addDaysIso(todayIso(), defaultTermsDays));
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([{ key: '1', description: '', quantity: '1', unit_price: '', revenue_account_id: null }]);
  const [accountPickerFor, setAccountPickerFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const customersQuery = useQuery({
    queryKey: ['customers', activeBusinessId],
    queryFn: () => listCustomers(activeBusinessId!),
    enabled: !!activeBusinessId, staleTime: 5 * 60_000,
  });
  const accountsQuery = useQuery({
    queryKey: ['coa', activeBusinessId],
    queryFn: () => listChartOfAccounts(activeBusinessId!),
    enabled: !!activeBusinessId, staleTime: 5 * 60_000,
  });

  const revenueAccounts = useMemo(() => (accountsQuery.data ?? []).filter(a => a.account_type === 'revenue' && a.is_active), [accountsQuery.data]);
  const customer = customersQuery.data?.find(c => c.id === customerId);

  useEffect(() => {
    if (!activeBusinessId) return;
    void getNextInvoiceNumber(activeBusinessId).then(n => { if (n) setInvoiceNumber(n); });
  }, [activeBusinessId]);

  function addLine() {
    setLines(prev => [...prev, { key: String(Date.now()), description: '', quantity: '1', unit_price: '', revenue_account_id: null }]);
  }
  function removeLine(key: string) {
    setLines(prev => prev.filter(l => l.key !== key));
  }
  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)));
  }

  async function handleSave(post: boolean) {
    if (!customerId) { setError('Pick a customer.'); return; }
    if (!invoiceNumber.trim()) { setError('Enter an invoice number.'); return; }
    const validLines = lines.filter(l => l.description.trim() && l.revenue_account_id && parseFloat(l.quantity) > 0 && parseFloat(l.unit_price) >= 0);
    if (validLines.length === 0) { setError('Add at least one line with a description, account, quantity, and price.'); return; }
    setError(null);
    setSaving(true);
    try {
      const lineInputs: InvoiceLineInput[] = validLines.map(l => ({
        description: l.description.trim(), quantity: l.quantity, unit_price: l.unit_price, revenue_account_id: l.revenue_account_id!,
      }));
      const created = await createInvoiceDraft(activeBusinessId!, {
        customer_id: customerId, invoice_number: invoiceNumber.trim(), issue_date: issueDate, due_date: dueDate,
        memo: memo || null, lines: lineInputs,
      });
      if (post) await postInvoice(activeBusinessId!, created.id);
      await queryClient.invalidateQueries({ queryKey: ['invoices'] });
      router.replace({ pathname: '/invoice/[id]', params: { id: created.id } });
    } catch (e) {
      setError(pickErr(e));
    } finally {
      setSaving(false);
    }
  }

  if (customersQuery.isLoading || accountsQuery.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <AppHeader title="New Invoice" leading="back" />
        <LoadingIndicator />
      </View>
    );
  }

  const total = lines.reduce((sum, l) => sum + (parseFloat(l.quantity) || 0) * (parseFloat(l.unit_price) || 0), 0);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="New Invoice" leading="back" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <PickerField label="Customer" value={customer?.name ?? null} onPress={() => setCustomerPickerOpen(true)} />
        <SearchablePicker
          visible={customerPickerOpen} onDismiss={() => setCustomerPickerOpen(false)} title="Pick a customer"
          options={(customersQuery.data ?? []).map(c => ({ id: c.id, label: c.name }))} onSelect={setCustomerId}
        />

        <AppTextInput label="Invoice number" value={invoiceNumber} onChangeText={setInvoiceNumber} containerStyle={{ marginBottom: spacing.md }} />

        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}><DateField label="Issue date" value={issueDate} onChange={setIssueDate} /></View>
          <View style={{ flex: 1 }}><DateField label="Due date" value={dueDate} onChange={setDueDate} /></View>
        </View>

        <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold, fontSize: typeScale.h3, marginTop: spacing.md, marginBottom: spacing.sm }}>Lines</Text>
        {lines.map(line => {
          const account = revenueAccounts.find(a => a.id === line.revenue_account_id);
          return (
            <View key={line.key} style={[styles.lineCard, { borderColor: theme.app.border }]}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm }}>
                <AppTextInput
                  label="Description" value={line.description} onChangeText={v => updateLine(line.key, { description: v })}
                  containerStyle={{ flex: 1 }}
                />
                {lines.length > 1 ? (
                  <Pressable onPress={() => removeLine(line.key)} hitSlop={8} style={{ marginBottom: spacing.md }}>
                    <MaterialCommunityIcons name="close-circle-outline" size={22} color={theme.app.destructive} />
                  </Pressable>
                ) : null}
              </View>
              <PickerField label="Revenue account" value={account ? `${account.code} — ${account.name}` : null} onPress={() => setAccountPickerFor(line.key)} />
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <AppTextInput
                  label="Quantity" value={line.quantity} onChangeText={v => updateLine(line.key, { quantity: v.replace(/[^0-9.]/g, '') })}
                  keyboardType="decimal-pad" containerStyle={{ flex: 1 }}
                />
                <AppTextInput
                  label="Unit price" value={line.unit_price} onChangeText={v => updateLine(line.key, { unit_price: v.replace(/[^0-9.]/g, '') })}
                  keyboardType="decimal-pad" left={<Text style={{ color: theme.app.mutedForeground }}>$</Text>} containerStyle={{ flex: 1 }}
                />
              </View>
            </View>
          );
        })}
        <SearchablePicker
          visible={!!accountPickerFor} onDismiss={() => setAccountPickerFor(null)} title="Pick a revenue account"
          options={revenueAccounts.map(a => ({ id: a.id, label: `${a.code} — ${a.name}` }))}
          onSelect={id => { if (accountPickerFor) updateLine(accountPickerFor, { revenue_account_id: id }); }}
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
        {canPost ? (
          <>
            <AppButton variant="outline" onPress={() => void handleSave(false)} loading={saving} style={{ flex: 1 }}>Save draft</AppButton>
            <AppButton onPress={() => void handleSave(true)} loading={saving} style={{ flex: 1 }}>Save & post</AppButton>
          </>
        ) : (
          <AppButton onPress={() => void handleSave(false)} loading={saving} style={{ flex: 1 }}>Save draft</AppButton>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md },
  lineCard: { borderWidth: 1, borderRadius: 8, padding: spacing.sm, marginBottom: spacing.sm, gap: spacing.sm },
  footer: {
    flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
