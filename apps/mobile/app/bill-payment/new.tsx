import { useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../hooks/useAuth';
import { AppHeader } from '../../components/AppHeader';
import { AppCard } from '../../components/ui/AppCard';
import { AppButton } from '../../components/ui/AppButton';
import { AppTextInput } from '../../components/ui/AppTextInput';
import { AppMenu, AppMenuItem } from '../../components/ui/AppMenu';
import { PickerField } from '../../components/PickerField';
import { SearchablePicker } from '../../components/SearchablePicker';
import { DateField } from '../../components/DateField';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import {
  listVendors, listBills, listChartOfAccounts, listBankAccounts,
  createBillPayment, postBillPayment, type PaymentMethod,
} from '../../services/api';
import { pickErr } from '../../services/apiClient';
import { statementBankAccounts } from '../../lib/bankAccountOptions';
import { fmtMoney } from '../../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../../theme';

const PAYMENT_METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'check', label: 'Check' }, { value: 'cash', label: 'Cash' },
  { value: 'ach', label: 'ACH' }, { value: 'wire', label: 'Wire' },
  { value: 'card', label: 'Card' }, { value: 'other', label: 'Other' },
];

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Vendor-side mirror of app/payment/new.tsx — same fields and allocation
 * UX (web's single-vendor BillPaymentNewPage.tsx, not the multi-vendor
 * batch "Pay Bills" grid — see services/api.ts's comment on why). Simpler
 * than the AR form in one way: listBills already returns open_balance
 * per row, so no per-bill detail fetch is needed the way invoices
 * required (listInvoices doesn't carry a balance, listBills does).
 */
export default function NewBillPaymentScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { activeBusinessId } = useAuth();
  const queryClient = useQueryClient();

  const [vendorId, setVendorId] = useState<string | null>(null);
  const [vendorPickerOpen, setVendorPickerOpen] = useState(false);
  const [date, setDate] = useState(todayIso());
  const [reference, setReference] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('check');
  const [methodMenuOpen, setMethodMenuOpen] = useState(false);
  const [cashAccountId, setCashAccountId] = useState<string | null>(null);
  const [cashAccountPickerOpen, setCashAccountPickerOpen] = useState(false);
  const [memo, setMemo] = useState('');
  const [amountOverride, setAmountOverride] = useState('');
  const [applications, setApplications] = useState<Record<string, string>>({}); // bill_id -> applied_amount
  const [fieldErrors, setFieldErrors] = useState<{ vendor?: string; cashAccount?: string }>({});
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
  const bankAccountsQuery = useQuery({
    queryKey: ['bank-accounts', activeBusinessId],
    queryFn: () => listBankAccounts(activeBusinessId!),
    enabled: !!activeBusinessId, staleTime: 5 * 60_000,
  });
  const openBillsQuery = useQuery({
    queryKey: ['vendor-open-bills', activeBusinessId, vendorId],
    queryFn: async () => {
      const rows = await listBills(activeBusinessId!, { status: 'posted', vendor_id: vendorId! });
      return rows.filter(b => parseFloat(b.open_balance) > 0);
    },
    enabled: !!activeBusinessId && !!vendorId,
  });

  const bankingAccountIds = useMemo(
    () => new Set((bankAccountsQuery.data ?? []).map(b => b.cash_account_id)),
    [bankAccountsQuery.data],
  );
  const cashAccountOptions = useMemo(
    () => statementBankAccounts(coaQuery.data ?? [], bankingAccountIds, cashAccountId ?? ''),
    [coaQuery.data, bankingAccountIds, cashAccountId],
  );
  const cashAccount = coaQuery.data?.find(a => a.id === cashAccountId);
  const vendor = vendorsQuery.data?.find(v => v.id === vendorId);

  const appliedTotal = useMemo(
    () => Object.values(applications).reduce((s, v) => s + (parseFloat(v) || 0), 0),
    [applications],
  );
  const amount = amountOverride !== '' ? (parseFloat(amountOverride) || 0) : appliedTotal;
  const unapplied = Math.max(0, amount - appliedTotal);

  function toggleBill(billId: string, balance: string) {
    setApplications(prev => {
      const next = { ...prev };
      if (billId in next) delete next[billId];
      else next[billId] = balance;
      return next;
    });
  }
  function setApplicationAmount(billId: string, value: string) {
    setApplications(prev => ({ ...prev, [billId]: value.replace(/[^0-9.]/g, '') }));
  }

  function validate(): typeof fieldErrors {
    const errors: typeof fieldErrors = {};
    if (!vendorId) errors.vendor = 'Pick a vendor.';
    if (!cashAccountId) errors.cashAccount = 'Pick a payment account.';
    return errors;
  }

  async function save() {
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    if (amount <= 0) { setServerError('Payment amount must be greater than zero.'); return; }
    setServerError(null);
    setSaving(true);
    try {
      const initial_applications = Object.entries(applications)
        .filter(([, amt]) => parseFloat(amt) > 0)
        .map(([bill_id, applied_amount]) => ({ bill_id, applied_amount }));
      const created = await createBillPayment(activeBusinessId!, {
        vendor_id: vendorId!,
        payment_date: date,
        payment_method: method,
        reference: reference || null,
        amount: amount.toFixed(2),
        cash_account_id: cashAccountId!,
        memo: memo || null,
        ...(initial_applications.length ? { initial_applications } : {}),
      });
      await postBillPayment(activeBusinessId!, created.id);
      await queryClient.invalidateQueries({ queryKey: ['bill-payments'] });
      await queryClient.invalidateQueries({ queryKey: ['bills'] });
      router.back();
    } catch (e) {
      setServerError(pickErr(e));
    } finally {
      setSaving(false);
    }
  }

  const loadingLookups = vendorsQuery.isLoading || coaQuery.isLoading || bankAccountsQuery.isLoading;
  if (loadingLookups) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <AppHeader title="Pay Bills" leading="back" />
        <LoadingIndicator />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Pay Bills" leading="back" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <PickerField label="Vendor" value={vendor?.name ?? null} onPress={() => setVendorPickerOpen(true)} error={fieldErrors.vendor} />
        <SearchablePicker
          visible={vendorPickerOpen}
          onDismiss={() => setVendorPickerOpen(false)}
          title="Pick a vendor"
          options={(vendorsQuery.data ?? []).map(v => ({ id: v.id, label: v.name }))}
          onSelect={(id) => { setVendorId(id); setApplications({}); setAmountOverride(''); }}
        />

        <DateField label="Payment date" value={date} onChange={setDate} />

        <AppTextInput label="Reference / check no. (optional)" value={reference} onChangeText={setReference} containerStyle={{ marginBottom: spacing.md }} />

        <View style={{ marginBottom: spacing.md }}>
          <Text style={{ fontSize: typeScale.caption, color: theme.app.mutedForeground, marginBottom: 4 }}>Payment method</Text>
          <AppMenu
            visible={methodMenuOpen}
            onDismiss={() => setMethodMenuOpen(false)}
            anchor={
              <Pressable onPress={() => setMethodMenuOpen(true)} style={[styles.field, { borderColor: theme.app.border, backgroundColor: theme.app.surface }]}>
                <Text style={{ color: theme.app.foreground, flex: 1 }}>{PAYMENT_METHODS.find(m => m.value === method)?.label}</Text>
              </Pressable>
            }
          >
            {PAYMENT_METHODS.map(m => (
              <AppMenuItem key={m.value} title={m.label} onPress={() => { setMethod(m.value); setMethodMenuOpen(false); }} />
            ))}
          </AppMenu>
        </View>

        <PickerField
          label="Payment account"
          value={cashAccount ? `${cashAccount.code} — ${cashAccount.name}` : null}
          onPress={() => setCashAccountPickerOpen(true)}
          error={fieldErrors.cashAccount}
        />
        <SearchablePicker
          visible={cashAccountPickerOpen}
          onDismiss={() => setCashAccountPickerOpen(false)}
          title="Pick a payment account"
          options={cashAccountOptions.map(a => ({ id: a.id, label: `${a.code} — ${a.name}` }))}
          onSelect={setCashAccountId}
        />

        {vendorId ? (
          <>
            <Text style={[styles.sectionTitle, { color: theme.app.foreground }]}>Outstanding bills</Text>
            {openBillsQuery.isLoading ? (
              <LoadingIndicator size="sm" />
            ) : (openBillsQuery.data ?? []).length === 0 ? (
              <Text style={{ color: theme.app.mutedForeground, marginBottom: spacing.md }}>No open bills for this vendor.</Text>
            ) : (
              <AppCard style={{ marginBottom: spacing.md }}>
                {(openBillsQuery.data ?? []).map((bill, i) => {
                  const checked = bill.id in applications;
                  return (
                    <View
                      key={bill.id}
                      style={[styles.billRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.app.border }]}
                    >
                      <Pressable style={styles.checkRow} onPress={() => toggleBill(bill.id, bill.open_balance)}>
                        <MaterialCommunityIcons
                          name={checked ? 'checkbox-marked' : 'checkbox-blank-outline'}
                          size={22}
                          color={checked ? theme.app.primary : theme.app.mutedForeground}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium }}>
                            {bill.bill_number ? `#${bill.bill_number}` : 'Bill'}
                          </Text>
                          <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>Balance ${fmtMoney(bill.open_balance)}</Text>
                        </View>
                      </Pressable>
                      {checked ? (
                        <AppTextInput
                          value={applications[bill.id] ?? ''}
                          onChangeText={(v) => setApplicationAmount(bill.id, v)}
                          keyboardType="decimal-pad"
                          left={<Text style={{ color: theme.app.mutedForeground }}>$</Text>}
                        />
                      ) : null}
                    </View>
                  );
                })}
              </AppCard>
            )}
          </>
        ) : null}

        <AppTextInput
          label="Amount paid (optional — defaults to the applied total)"
          placeholder={appliedTotal > 0 ? fmtMoney(appliedTotal) : '0.00'}
          value={amountOverride}
          onChangeText={(v) => setAmountOverride(v.replace(/[^0-9.]/g, ''))}
          keyboardType="decimal-pad"
          left={<Text style={{ color: theme.app.mutedForeground }}>$</Text>}
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

        <View style={[styles.totalRow, { borderColor: theme.app.border }]}>
          <View>
            <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold }}>Total paid</Text>
            {unapplied > 0 ? (
              <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>${fmtMoney(unapplied)} unapplied</Text>
            ) : null}
          </View>
          <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.bold, fontSize: typeScale.h2 }}>${fmtMoney(amount)}</Text>
        </View>

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
  field: { flexDirection: 'row', alignItems: 'center', minHeight: 40, borderWidth: 1, borderRadius: 6, paddingHorizontal: spacing.sm },
  sectionTitle: { fontSize: typeScale.h3, fontFamily: fontFamily.semibold, marginBottom: spacing.sm },
  billRow: { padding: spacing.md, gap: spacing.sm },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  totalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, marginBottom: spacing.md,
  },
  footer: {
    flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
