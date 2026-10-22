import { useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, Pressable, Alert } from 'react-native';
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
  listCustomers, listInvoices, getInvoice, listChartOfAccounts, listBankAccounts,
  createPayment, postPayment, type PaymentMethod, type InvoiceDetail,
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
 * Same fields and allocation UX as web's PaymentNewPage.tsx: pick a
 * customer, check the open invoices to apply the payment to (checking one
 * auto-fills its full balance, editable after), an optional "amount
 * received" that defaults to the sum of what's checked — then save-and-
 * post in one step (web's useSaveAndPost), same as this app's other
 * transaction forms immediately posting on save. No separate draft-only
 * save path on mobile; unlike Expense/Deposit, payments have no edit
 * screen (editing an existing payment's invoice allocations isn't built
 * here — add/remove-application endpoints exist server-side but aren't
 * wired up this chunk, scoped to the normal "create and post" case).
 */
export default function NewPaymentScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { activeBusinessId } = useAuth();
  const queryClient = useQueryClient();

  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [date, setDate] = useState(todayIso());
  const [reference, setReference] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('check');
  const [methodMenuOpen, setMethodMenuOpen] = useState(false);
  const [cashAccountId, setCashAccountId] = useState<string | null>(null);
  const [cashAccountPickerOpen, setCashAccountPickerOpen] = useState(false);
  const [memo, setMemo] = useState('');
  const [amountOverride, setAmountOverride] = useState('');
  const [applications, setApplications] = useState<Record<string, string>>({}); // invoice_id -> applied_amount
  const [fieldErrors, setFieldErrors] = useState<{ customer?: string; cashAccount?: string }>({});
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
  const bankAccountsQuery = useQuery({
    queryKey: ['bank-accounts', activeBusinessId],
    queryFn: () => listBankAccounts(activeBusinessId!),
    enabled: !!activeBusinessId, staleTime: 5 * 60_000,
  });
  // Open invoices for the selected customer — same N+1 pattern web uses
  // (list doesn't carry a balance, so each posted invoice's detail is
  // fetched to read amount_due).
  const openInvoicesQuery = useQuery({
    queryKey: ['customer-open-invoices', activeBusinessId, customerId],
    queryFn: async (): Promise<InvoiceDetail[]> => {
      const rows = await listInvoices(activeBusinessId!, { status: 'posted', customer_id: customerId! });
      const details = await Promise.all(rows.map(r => getInvoice(activeBusinessId!, r.id)));
      return details.filter(d => parseFloat(d.amount_due) > 0);
    },
    enabled: !!activeBusinessId && !!customerId,
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
  const customer = customersQuery.data?.find(c => c.id === customerId);

  const appliedTotal = useMemo(
    () => Object.values(applications).reduce((s, v) => s + (parseFloat(v) || 0), 0),
    [applications],
  );
  const amount = amountOverride !== '' ? (parseFloat(amountOverride) || 0) : appliedTotal;
  const unapplied = Math.max(0, amount - appliedTotal);

  function toggleInvoice(invoiceId: string, balance: string) {
    setApplications(prev => {
      const next = { ...prev };
      if (invoiceId in next) delete next[invoiceId];
      else next[invoiceId] = balance;
      return next;
    });
  }
  function setApplicationAmount(invoiceId: string, value: string) {
    setApplications(prev => ({ ...prev, [invoiceId]: value.replace(/[^0-9.]/g, '') }));
  }

  function validate(): typeof fieldErrors {
    const errors: typeof fieldErrors = {};
    if (!customerId) errors.customer = 'Pick a customer.';
    if (!cashAccountId) errors.cashAccount = 'Pick a deposit-to account.';
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
        .map(([invoice_id, applied_amount]) => ({ invoice_id, applied_amount }));
      const created = await createPayment(activeBusinessId!, {
        customer_id: customerId!,
        payment_date: date,
        payment_method: method,
        reference: reference || null,
        amount: amount.toFixed(2),
        cash_account_id: cashAccountId!,
        memo: memo || null,
        ...(initial_applications.length ? { initial_applications } : {}),
      });
      await postPayment(activeBusinessId!, created.id);
      await queryClient.invalidateQueries({ queryKey: ['payments'] });
      await queryClient.invalidateQueries({ queryKey: ['invoices'] });
      router.back();
    } catch (e) {
      setServerError(pickErr(e));
    } finally {
      setSaving(false);
    }
  }

  const loadingLookups = customersQuery.isLoading || coaQuery.isLoading || bankAccountsQuery.isLoading;
  if (loadingLookups) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <AppHeader title="Record Payment" leading="back" />
        <LoadingIndicator />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Record Payment" leading="back" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <PickerField label="Customer" value={customer?.name ?? null} onPress={() => setCustomerPickerOpen(true)} error={fieldErrors.customer} />
        <SearchablePicker
          visible={customerPickerOpen}
          onDismiss={() => setCustomerPickerOpen(false)}
          title="Pick a customer"
          options={(customersQuery.data ?? []).map(c => ({ id: c.id, label: c.name }))}
          onSelect={(id) => { setCustomerId(id); setApplications({}); setAmountOverride(''); }}
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
          label="Deposit to"
          value={cashAccount ? `${cashAccount.code} — ${cashAccount.name}` : null}
          onPress={() => setCashAccountPickerOpen(true)}
          error={fieldErrors.cashAccount}
        />
        <SearchablePicker
          visible={cashAccountPickerOpen}
          onDismiss={() => setCashAccountPickerOpen(false)}
          title="Pick a deposit-to account"
          options={cashAccountOptions.map(a => ({ id: a.id, label: `${a.code} — ${a.name}` }))}
          onSelect={setCashAccountId}
        />

        {customerId ? (
          <>
            <Text style={[styles.sectionTitle, { color: theme.app.foreground }]}>Outstanding invoices</Text>
            {openInvoicesQuery.isLoading ? (
              <LoadingIndicator size="sm" />
            ) : (openInvoicesQuery.data ?? []).length === 0 ? (
              <Text style={{ color: theme.app.mutedForeground, marginBottom: spacing.md }}>No open invoices for this customer.</Text>
            ) : (
              <AppCard style={{ marginBottom: spacing.md }}>
                {(openInvoicesQuery.data ?? []).map((inv, i) => {
                  const checked = inv.invoice.id in applications;
                  return (
                    <View
                      key={inv.invoice.id}
                      style={[styles.invoiceRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.app.border }]}
                    >
                      <Pressable style={styles.checkRow} onPress={() => toggleInvoice(inv.invoice.id, inv.amount_due)}>
                        <MaterialCommunityIcons
                          name={checked ? 'checkbox-marked' : 'checkbox-blank-outline'}
                          size={22}
                          color={checked ? theme.app.primary : theme.app.mutedForeground}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium }}>#{inv.invoice.invoice_number}</Text>
                          <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>Balance ${fmtMoney(inv.amount_due)}</Text>
                        </View>
                      </Pressable>
                      {checked ? (
                        <AppTextInput
                          value={applications[inv.invoice.id] ?? ''}
                          onChangeText={(v) => setApplicationAmount(inv.invoice.id, v)}
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
          label="Amount received (optional — defaults to the applied total)"
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
            <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold }}>Total received</Text>
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
  invoiceRow: { padding: spacing.md, gap: spacing.sm },
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
