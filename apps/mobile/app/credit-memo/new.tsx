import { useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
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
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { listCustomers, listChartOfAccounts, createCreditMemo, postCreditMemo } from '../../services/api';
import { pickErr } from '../../services/apiClient';
import { spacing, type AppTheme } from '../../theme';

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Single-amount form, same shape as web's CreditMemoNewPage.tsx (no line
 * items, unlike invoices — a credit memo is customer + date + one amount
 * + a revenue account + a memo). Save-and-post in one step, same
 * simplification already used for Payment/BillPayment, rather than
 * offering web's separate "save as draft" option. Applying the memo to
 * an invoice is a deliberately separate step, done from the detail
 * screen after posting — matches web, which doesn't let you apply at
 * creation time either (credit memos have no initial_applications field).
 */
export default function NewCreditMemoScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { activeBusinessId } = useAuth();
  const queryClient = useQueryClient();

  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [date, setDate] = useState(todayIso());
  const [revenueAccountId, setRevenueAccountId] = useState<string | null>(null);
  const [revenueAccountPickerOpen, setRevenueAccountPickerOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ customer?: string; revenueAccount?: string; amount?: string }>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const customersQuery = useQuery({
    queryKey: ['customers', activeBusinessId],
    queryFn: () => listCustomers(activeBusinessId!),
    enabled: !!activeBusinessId, staleTime: 5 * 60_000,
  });
  const coaQuery = useQuery({
    queryKey: ['coa', activeBusinessId],
    queryFn: () => listChartOfAccounts(activeBusinessId!),
    enabled: !!activeBusinessId, staleTime: 5 * 60_000,
  });

  const revenueAccounts = useMemo(() => (coaQuery.data ?? []).filter(a => a.account_type === 'revenue'), [coaQuery.data]);
  const revenueAccount = coaQuery.data?.find(a => a.id === revenueAccountId);
  const customer = customersQuery.data?.find(c => c.id === customerId);

  function validate(): typeof fieldErrors {
    const errors: typeof fieldErrors = {};
    if (!customerId) errors.customer = 'Pick a customer.';
    if (!revenueAccountId) errors.revenueAccount = 'Pick a revenue account.';
    if (!(parseFloat(amount) > 0)) errors.amount = 'Enter an amount greater than zero.';
    return errors;
  }

  async function save() {
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setServerError(null);
    setSaving(true);
    try {
      const created = await createCreditMemo(activeBusinessId!, {
        customer_id: customerId!,
        memo_date: date,
        amount,
        revenue_account_id: revenueAccountId!,
        memo: memo || null,
      });
      await postCreditMemo(activeBusinessId!, created.id);
      await queryClient.invalidateQueries({ queryKey: ['credit-memos'] });
      router.back();
    } catch (e) {
      setServerError(pickErr(e));
    } finally {
      setSaving(false);
    }
  }

  const loadingLookups = customersQuery.isLoading || coaQuery.isLoading;
  if (loadingLookups) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <AppHeader title="New Credit Memo" leading="back" />
        <LoadingIndicator />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="New Credit Memo" leading="back" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <PickerField label="Customer" value={customer?.name ?? null} onPress={() => setCustomerPickerOpen(true)} error={fieldErrors.customer} />
        <SearchablePicker
          visible={customerPickerOpen}
          onDismiss={() => setCustomerPickerOpen(false)}
          title="Pick a customer"
          options={(customersQuery.data ?? []).map(c => ({ id: c.id, label: c.name }))}
          onSelect={setCustomerId}
        />

        <DateField label="Date" value={date} onChange={setDate} />

        <PickerField
          label="Revenue account"
          value={revenueAccount ? `${revenueAccount.code} — ${revenueAccount.name}` : null}
          onPress={() => setRevenueAccountPickerOpen(true)}
          error={fieldErrors.revenueAccount}
        />
        <SearchablePicker
          visible={revenueAccountPickerOpen}
          onDismiss={() => setRevenueAccountPickerOpen(false)}
          title="Pick a revenue account"
          options={revenueAccounts.map(a => ({ id: a.id, label: `${a.code} — ${a.name}` }))}
          onSelect={setRevenueAccountId}
        />

        <AppTextInput
          label="Amount"
          placeholder="0.00"
          value={amount}
          onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, ''))}
          keyboardType="decimal-pad"
          left={<Text style={{ color: theme.app.mutedForeground }}>$</Text>}
          error={fieldErrors.amount}
          containerStyle={{ marginBottom: spacing.md }}
        />

        <AppTextInput
          label="Memo"
          value={memo}
          onChangeText={setMemo}
          multiline
          style={{ minHeight: 64, textAlignVertical: 'top' }}
          containerStyle={{ marginBottom: spacing.lg }}
        />

        {serverError ? <Text style={{ color: theme.app.destructive, marginBottom: spacing.sm }}>{serverError}</Text> : null}
      </ScrollView>

      <View style={[styles.footer, { borderColor: theme.app.border, backgroundColor: theme.app.surface, paddingBottom: insets.bottom + spacing.sm }]}>
        <AppButton variant="outline" onPress={() => router.back()}>Cancel</AppButton>
        <AppButton onPress={() => void save()} loading={saving} style={{ flex: 1 }}>Save &amp; post</AppButton>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md },
  footer: {
    flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
