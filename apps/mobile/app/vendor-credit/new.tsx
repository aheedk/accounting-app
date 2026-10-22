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
import { listVendors, listChartOfAccounts, createVendorCredit, postVendorCredit } from '../../services/api';
import { pickErr } from '../../services/apiClient';
import { spacing, type AppTheme } from '../../theme';

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Vendor-side mirror of app/credit-memo/new.tsx — single amount, no line
 * items, save-and-post in one step. Offset account here is filtered to
 * expense-type accounts (the natural case: reversing an expense you were
 * originally billed for), same scoping choice already made for the AR
 * side's revenue-account filter.
 */
export default function NewVendorCreditScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { activeBusinessId } = useAuth();
  const queryClient = useQueryClient();

  const [vendorId, setVendorId] = useState<string | null>(null);
  const [vendorPickerOpen, setVendorPickerOpen] = useState(false);
  const [date, setDate] = useState(todayIso());
  const [offsetAccountId, setOffsetAccountId] = useState<string | null>(null);
  const [offsetAccountPickerOpen, setOffsetAccountPickerOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ vendor?: string; offsetAccount?: string; amount?: string }>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const vendorsQuery = useQuery({
    queryKey: ['vendors', activeBusinessId],
    queryFn: () => listVendors(activeBusinessId!),
    enabled: !!activeBusinessId, staleTime: 5 * 60_000,
  });
  const coaQuery = useQuery({
    queryKey: ['coa', activeBusinessId],
    queryFn: () => listChartOfAccounts(activeBusinessId!),
    enabled: !!activeBusinessId, staleTime: 5 * 60_000,
  });

  const offsetAccounts = useMemo(() => (coaQuery.data ?? []).filter(a => a.account_type === 'expense'), [coaQuery.data]);
  const offsetAccount = coaQuery.data?.find(a => a.id === offsetAccountId);
  const vendor = vendorsQuery.data?.find(v => v.id === vendorId);

  function validate(): typeof fieldErrors {
    const errors: typeof fieldErrors = {};
    if (!vendorId) errors.vendor = 'Pick a vendor.';
    if (!offsetAccountId) errors.offsetAccount = 'Pick an offset account.';
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
      const created = await createVendorCredit(activeBusinessId!, {
        vendor_id: vendorId!,
        credit_date: date,
        amount,
        offset_account_id: offsetAccountId!,
        memo: memo || null,
      });
      await postVendorCredit(activeBusinessId!, created.id);
      await queryClient.invalidateQueries({ queryKey: ['vendor-credits'] });
      router.back();
    } catch (e) {
      setServerError(pickErr(e));
    } finally {
      setSaving(false);
    }
  }

  const loadingLookups = vendorsQuery.isLoading || coaQuery.isLoading;
  if (loadingLookups) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <AppHeader title="New Vendor Credit" leading="back" />
        <LoadingIndicator />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="New Vendor Credit" leading="back" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <PickerField label="Vendor" value={vendor?.name ?? null} onPress={() => setVendorPickerOpen(true)} error={fieldErrors.vendor} />
        <SearchablePicker
          visible={vendorPickerOpen}
          onDismiss={() => setVendorPickerOpen(false)}
          title="Pick a vendor"
          options={(vendorsQuery.data ?? []).map(v => ({ id: v.id, label: v.name }))}
          onSelect={setVendorId}
        />

        <DateField label="Date" value={date} onChange={setDate} />

        <PickerField
          label="Offset account"
          value={offsetAccount ? `${offsetAccount.code} — ${offsetAccount.name}` : null}
          onPress={() => setOffsetAccountPickerOpen(true)}
          error={fieldErrors.offsetAccount}
        />
        <SearchablePicker
          visible={offsetAccountPickerOpen}
          onDismiss={() => setOffsetAccountPickerOpen(false)}
          title="Pick an offset account"
          options={offsetAccounts.map(a => ({ id: a.id, label: `${a.code} — ${a.name}` }))}
          onSelect={setOffsetAccountId}
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
