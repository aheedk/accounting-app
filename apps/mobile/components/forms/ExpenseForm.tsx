import { useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, Pressable, Alert } from 'react-native';
import { Text, Button, Menu, IconButton, useTheme } from 'react-native-paper';
import { AppTextInput } from '../ui/AppTextInput';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useAuth } from '../../hooks/useAuth';
import {
  listChartOfAccounts, listBankAccounts, listVendors, listCustomers,
  createExpense, updateExpense, voidExpense, deleteExpense,
  type ExpenseDetail, type ExpenseInput, type ExpenseLineInput,
} from '../../services/api';
import { pickErr } from '../../services/apiClient';
import { expensePaymentAccounts, categoryAccountsFirst } from '../../lib/bankAccountOptions';
import { PickerField } from '../PickerField';
import { DateField } from '../DateField';
import { SearchablePicker, type PickerOption } from '../SearchablePicker';
import { LoadingIndicator } from '../LoadingIndicator';
import { TransactionFormFooter } from './TransactionFormFooter';
import { spacing, typeScale, minTouchTarget, type AppTheme } from '../../theme';

const PAYMENT_METHODS: Array<{ value: ExpenseInput['payment_method']; label: string }> = [
  { value: 'check', label: 'Check' }, { value: 'credit_card', label: 'Credit Card' },
  { value: 'debit_card', label: 'Debit Card' }, { value: 'cash', label: 'Cash' },
  { value: 'ach', label: 'ACH' }, { value: 'other', label: 'Other' },
];

type Line = ExpenseLineInput & { key: string };
let lineKeySeq = 0;
const newLine = (): Line => ({ key: `l${lineKeySeq++}`, category_account_id: '', description: '', amount: '' });

type PayeeKind = 'vendor' | 'customer' | 'text';

export function ExpenseForm({ existing, existingId }: { existing?: ExpenseDetail; existingId?: string }) {
  const theme = useTheme<AppTheme>();
  const { activeBusinessId } = useAuth();
  const queryClient = useQueryClient();

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
  const vendorsQuery = useQuery({
    queryKey: ['vendors', activeBusinessId],
    queryFn: () => listVendors(activeBusinessId!),
    enabled: !!activeBusinessId, staleTime: 5 * 60_000,
  });
  const customersQuery = useQuery({
    queryKey: ['customers', activeBusinessId],
    queryFn: () => listCustomers(activeBusinessId!),
    enabled: !!activeBusinessId, staleTime: 5 * 60_000,
  });

  const [date, setDate] = useState(existing?.transaction_date ?? new Date().toISOString().slice(0, 10));
  const [payeeKind, setPayeeKind] = useState<PayeeKind>(
    existing?.vendor_id ? 'vendor' : existing?.customer_id ? 'customer' : 'text',
  );
  const [payeeId, setPayeeId] = useState<string | null>(existing?.vendor_id ?? existing?.customer_id ?? null);
  const [payeeText, setPayeeText] = useState(existing?.payee_text ?? '');
  const [paymentAccountId, setPaymentAccountId] = useState<string | null>(existing?.payment_account_id ?? null);
  const [paymentMethod, setPaymentMethod] = useState<ExpenseInput['payment_method']>(
    (existing?.payment_method as ExpenseInput['payment_method']) ?? 'other',
  );
  const [reference, setReference] = useState(existing?.reference ?? '');
  const [memo, setMemo] = useState(existing?.memo ?? '');
  const [lines, setLines] = useState<Line[]>(
    existing?.lines.length
      ? existing.lines.map(l => ({ key: `e${l.id}`, category_account_id: l.category_account_id, description: l.description, amount: l.amount }))
      : [newLine()],
  );
  const [payeePickerOpen, setPayeePickerOpen] = useState(false);
  const [paymentAccountPickerOpen, setPaymentAccountPickerOpen] = useState(false);
  const [categoryPickerFor, setCategoryPickerFor] = useState<string | null>(null);
  const [methodMenuOpen, setMethodMenuOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ payee?: string; paymentAccount?: string; lines?: string }>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // "Copy" (web's More menu) keeps every field as-is but targets a new
  // record on the next Save — same bottom-bar pattern as web's editor.
  const [copied, setCopied] = useState(false);
  const effectiveExistingId = copied ? undefined : existingId;

  const bankingAccountIds = useMemo(
    () => new Set((bankAccountsQuery.data ?? []).map(b => b.cash_account_id)),
    [bankAccountsQuery.data],
  );
  const paymentAccountOptions = useMemo(
    () => expensePaymentAccounts(coaQuery.data ?? [], bankingAccountIds, paymentAccountId ?? ''),
    [coaQuery.data, bankingAccountIds, paymentAccountId],
  );
  const categoryOptions = useMemo(() => categoryAccountsFirst(coaQuery.data ?? []), [coaQuery.data]);

  const payeeOptions: PickerOption[] = useMemo(() => [
    ...(vendorsQuery.data ?? []).map(v => ({ id: `vendor:${v.id}`, label: v.name, sublabel: 'Vendor' })),
    ...(customersQuery.data ?? []).map(c => ({ id: `customer:${c.id}`, label: c.name, sublabel: 'Customer' })),
  ], [vendorsQuery.data, customersQuery.data]);

  const paymentAccountName = coaQuery.data?.find(a => a.id === paymentAccountId);
  const payeeLabel = payeeKind === 'text'
    ? (payeeText || null)
    : (payeeKind === 'vendor' ? vendorsQuery.data : customersQuery.data)?.find(x => x.id === payeeId)?.name ?? null;

  const total = lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
  const loadingLookups = coaQuery.isLoading || bankAccountsQuery.isLoading || vendorsQuery.isLoading || customersQuery.isLoading;

  function updateLine(key: string, patch: Partial<Line>) {
    setLines(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeLine(key: string) {
    setLines(prev => (prev.length > 1 ? prev.filter(l => l.key !== key) : prev));
  }

  function validate(): typeof fieldErrors {
    const validLines = lines.filter(l => l.category_account_id && parseFloat(l.amount) > 0);
    const errors: typeof fieldErrors = {};
    if (!payeeLabel) errors.payee = 'Pick a payee.';
    if (!paymentAccountId) errors.paymentAccount = 'Pick a payment account.';
    if (validLines.length === 0) errors.lines = 'Add at least one line with a category and an amount.';
    else if (total <= 0) errors.lines = 'The expense total must be greater than zero.';
    return errors;
  }

  async function save() {
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setServerError(null);
    setSaving(true);
    try {
      const body: ExpenseInput = {
        transaction_date: date,
        payment_account_id: paymentAccountId!,
        payment_method: paymentMethod,
        reference: reference || null,
        memo: memo || null,
        lines: lines
          .filter(l => l.category_account_id && parseFloat(l.amount) > 0)
          .map((l, i) => ({ category_account_id: l.category_account_id, description: l.description || null, amount: l.amount, sort_order: i })),
        ...(payeeKind === 'vendor' ? { vendor_id: payeeId } : payeeKind === 'customer' ? { customer_id: payeeId } : { payee_text: payeeText }),
      };
      if (effectiveExistingId) await updateExpense(activeBusinessId!, effectiveExistingId, body);
      else await createExpense(activeBusinessId!, body);
      await queryClient.invalidateQueries({ queryKey: ['transactions'] });
      await queryClient.invalidateQueries({ queryKey: ['transaction-detail'] });
      router.back();
    } catch (e) {
      setServerError(pickErr(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleVoid() {
    if (!existingId) return;
    Alert.alert('Void this expense?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Void', style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await voidExpense(activeBusinessId!, existingId);
              await queryClient.invalidateQueries({ queryKey: ['transactions'] });
              await queryClient.invalidateQueries({ queryKey: ['transaction-detail'] });
              router.back();
            } catch (e) { setServerError(pickErr(e)); }
          })();
        },
      },
    ]);
  }

  async function handleDelete() {
    if (!existingId) return;
    Alert.alert('Delete this expense?', 'This permanently removes it. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteExpense(activeBusinessId!, existingId);
              await queryClient.invalidateQueries({ queryKey: ['transactions'] });
              router.back();
            } catch (e) { setServerError(pickErr(e)); }
          })();
        },
      },
    ]);
  }

  if (loadingLookups) return <LoadingIndicator />;

  return (
    <View style={{ flex: 1 }}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <DateField label="Date" value={date} onChange={setDate} />

      <PickerField label="Payee" value={payeeLabel} onPress={() => setPayeePickerOpen(true)} error={fieldErrors.payee} />
      <SearchablePicker
        visible={payeePickerOpen}
        onDismiss={() => setPayeePickerOpen(false)}
        title="Pick a payee"
        options={payeeOptions}
        onSelect={(id) => {
          const [kind, rawId] = id.split(':');
          setPayeeKind(kind as PayeeKind);
          setPayeeId(rawId ?? null);
        }}
        footer={<FreeTextPayeeFooter theme={theme} onUse={(text) => { setPayeeKind('text'); setPayeeText(text); setPayeePickerOpen(false); }} />}
      />

      <PickerField
        label="Payment account"
        value={paymentAccountName ? `${paymentAccountName.code} — ${paymentAccountName.name}` : null}
        onPress={() => setPaymentAccountPickerOpen(true)}
        error={fieldErrors.paymentAccount}
      />
      <SearchablePicker
        visible={paymentAccountPickerOpen}
        onDismiss={() => setPaymentAccountPickerOpen(false)}
        title="Pick a payment account"
        options={paymentAccountOptions.map(a => ({ id: a.id, label: `${a.code} — ${a.name}` }))}
        onSelect={setPaymentAccountId}
      />

      <View style={{ marginBottom: spacing.md }}>
        <Text style={{ fontSize: typeScale.caption, color: theme.app.mutedForeground, marginBottom: 4 }}>Payment method</Text>
        <Menu
          visible={methodMenuOpen}
          onDismiss={() => setMethodMenuOpen(false)}
          anchor={
            <Pressable
              onPress={() => setMethodMenuOpen(true)}
              style={[styles.field, { minHeight: minTouchTarget, borderColor: theme.app.border, backgroundColor: theme.app.surface }]}
            >
              <Text style={{ color: theme.app.foreground, flex: 1 }}>
                {PAYMENT_METHODS.find(m => m.value === paymentMethod)?.label}
              </Text>
            </Pressable>
          }
        >
          {PAYMENT_METHODS.map(m => (
            <Menu.Item key={m.value} title={m.label} onPress={() => { setPaymentMethod(m.value); setMethodMenuOpen(false); }} />
          ))}
        </Menu>
      </View>

      <Text style={[styles.sectionTitle, { color: theme.app.foreground }]}>Lines</Text>
      {fieldErrors.lines ? (
        <Text style={{ color: theme.app.destructive, fontSize: typeScale.caption, marginBottom: spacing.sm }}>{fieldErrors.lines}</Text>
      ) : null}
      {lines.map(line => {
        const category = categoryOptions.find(a => a.id === line.category_account_id);
        return (
          <View key={line.key} style={[styles.lineCard, { borderColor: theme.app.border, backgroundColor: theme.app.surface }]}>
            <View style={styles.lineHeader}>
              <View style={{ flex: 1 }}>
                <PickerField
                  label="Category"
                  value={category ? `${category.code} — ${category.name}` : null}
                  onPress={() => setCategoryPickerFor(line.key)}
                />
              </View>
              <IconButton icon="trash-can-outline" size={20} onPress={() => removeLine(line.key)} disabled={lines.length === 1} />
            </View>
            <SearchablePicker
              visible={categoryPickerFor === line.key}
              onDismiss={() => setCategoryPickerFor(null)}
              title="Pick a category"
              options={categoryOptions.map(a => ({ id: a.id, label: `${a.code} — ${a.name}` }))}
              onSelect={(id) => updateLine(line.key, { category_account_id: id })}
            />
            <AppTextInput
              placeholder="Description (optional)"
              value={line.description ?? ''}
              onChangeText={(v) => updateLine(line.key, { description: v })}
              containerStyle={{ marginBottom: spacing.sm }}
            />
            <AppTextInput
              placeholder="0.00"
              value={line.amount}
              onChangeText={(v) => updateLine(line.key, { amount: v.replace(/[^0-9.]/g, '') })}
              keyboardType="decimal-pad"
              left={<Text style={{ color: theme.app.mutedForeground }}>$</Text>}
            />
          </View>
        );
      })}
      <Button mode="outlined" icon="plus" onPress={() => setLines(prev => [...prev, newLine()])} style={{ marginBottom: spacing.md }}>
        Add line
      </Button>

      <AppTextInput
        label="Reference (optional)"
        value={reference}
        onChangeText={setReference}
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
        <Text style={{ color: theme.app.foreground, fontWeight: '600' }}>Total</Text>
        <Text style={{ color: theme.app.foreground, fontWeight: '700', fontSize: typeScale.h2 }}>${total.toFixed(2)}</Text>
      </View>

      {serverError ? <Text style={{ color: theme.app.destructive, marginBottom: spacing.sm }}>{serverError}</Text> : null}
    </ScrollView>
      <TransactionFormFooter
        existingId={effectiveExistingId}
        journalEntryId={existing?.journal_entry_id}
        saving={saving}
        saveLabel={effectiveExistingId ? 'Save changes' : 'Save expense'}
        onSave={() => void save()}
        onCopy={existingId ? () => setCopied(true) : undefined}
        onVoid={existingId ? () => void handleVoid() : undefined}
        onDelete={existingId ? () => void handleDelete() : undefined}
      />
    </View>
  );
}

function FreeTextPayeeFooter({ theme, onUse }: { theme: AppTheme; onUse: (text: string) => void }) {
  const [text, setText] = useState('');
  return (
    <View style={{ paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.app.border }}>
      <AppTextInput
        placeholder="Or type a one-off payee name"
        value={text}
        onChangeText={setText}
        right={text ? <IconButton icon="check" size={18} onPress={() => onUse(text)} style={{ margin: 0 }} /> : undefined}
        onSubmitEditing={() => text && onUse(text)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md },
  field: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 8, paddingHorizontal: spacing.sm },
  sectionTitle: { fontSize: typeScale.h2, fontWeight: '700', marginBottom: spacing.sm },
  lineCard: { borderWidth: 1, borderRadius: 10, padding: spacing.sm, marginBottom: spacing.sm },
  lineHeader: { flexDirection: 'row', alignItems: 'flex-start' },
  totalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, marginBottom: spacing.md,
  },
});
