import { useEffect, useMemo, useState } from 'react';
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
import { AppSegmentedControl } from '../../components/ui/AppSegmentedControl';
import { PickerField } from '../../components/PickerField';
import { SearchablePicker } from '../../components/SearchablePicker';
import { DateField } from '../../components/DateField';
import {
  listVendors, listCustomers, listBankAccounts, listChartOfAccounts,
  getNextCheckNumber, createCheck, type CheckPayeeType, type CheckLineInput,
} from '../../services/api';
import { pickErr } from '../../services/apiClient';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { fmtMoney } from '../../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../../theme';

const todayIso = () => new Date().toISOString().slice(0, 10);

type DraftLine = { key: string; account_id: string | null; description: string; amount: string };

export default function NewCheckScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { activeBusinessId } = useAuth();
  const queryClient = useQueryClient();

  const [payeeType, setPayeeType] = useState<CheckPayeeType>('vendor');
  const [payeeId, setPayeeId] = useState<string | null>(null);
  const [payeeText, setPayeeText] = useState('');
  const [payeePickerOpen, setPayeePickerOpen] = useState(false);
  const [bankAccountId, setBankAccountId] = useState<string | null>(null);
  const [bankPickerOpen, setBankPickerOpen] = useState(false);
  const [checkNumber, setCheckNumber] = useState('');
  const [paymentDate, setPaymentDate] = useState(todayIso());
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([{ key: '1', account_id: null, description: '', amount: '' }]);
  const [accountPickerFor, setAccountPickerFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const vendorsQuery = useQuery({
    queryKey: ['vendors', activeBusinessId],
    queryFn: () => listVendors(activeBusinessId!),
    enabled: !!activeBusinessId && payeeType === 'vendor', staleTime: 5 * 60_000,
  });
  const customersQuery = useQuery({
    queryKey: ['customers', activeBusinessId],
    queryFn: () => listCustomers(activeBusinessId!),
    enabled: !!activeBusinessId && payeeType === 'customer', staleTime: 5 * 60_000,
  });
  const bankAccountsQuery = useQuery({
    queryKey: ['bank-accounts', activeBusinessId],
    queryFn: () => listBankAccounts(activeBusinessId!),
    enabled: !!activeBusinessId, staleTime: 5 * 60_000,
  });
  const accountsQuery = useQuery({
    queryKey: ['coa', activeBusinessId],
    queryFn: () => listChartOfAccounts(activeBusinessId!),
    enabled: !!activeBusinessId, staleTime: 5 * 60_000,
  });

  // Expense accounts first, same convenience ordering as web's CheckPage.
  const orderedAccounts = useMemo(() => {
    const all = accountsQuery.data ?? [];
    return [...all.filter(a => a.account_type === 'expense'), ...all.filter(a => a.account_type !== 'expense')];
  }, [accountsQuery.data]);

  const vendor = vendorsQuery.data?.find(v => v.id === payeeId);
  const customer = customersQuery.data?.find(c => c.id === payeeId);
  const bankAccount = bankAccountsQuery.data?.find(b => b.id === bankAccountId);

  useEffect(() => {
    setPayeeId(null);
  }, [payeeType]);

  useEffect(() => {
    if (!activeBusinessId || !bankAccountId) return;
    void getNextCheckNumber(activeBusinessId, bankAccountId).then(n => { if (n) setCheckNumber(n); });
  }, [activeBusinessId, bankAccountId]);

  function addLine() {
    setLines(prev => [...prev, { key: String(Date.now()), account_id: null, description: '', amount: '' }]);
  }
  function removeLine(key: string) {
    setLines(prev => prev.filter(l => l.key !== key));
  }
  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)));
  }

  async function handleSave() {
    if (!bankAccountId) { setError('Pick a bank account.'); return; }
    if (payeeType !== 'other' && !payeeId) { setError('Pick a payee.'); return; }
    if (payeeType === 'other' && !payeeText.trim()) { setError('Enter a payee name.'); return; }
    const validLines = lines.filter(l => l.account_id && parseFloat(l.amount) > 0);
    if (validLines.length === 0) { setError('Add at least one line with an account and amount.'); return; }
    setError(null);
    setSaving(true);
    try {
      const lineInputs: CheckLineInput[] = validLines.map(l => ({
        account_id: l.account_id!, description: l.description || null, amount: l.amount,
      }));
      const created = await createCheck(activeBusinessId!, {
        payment_date: paymentDate, bank_account_id: bankAccountId, check_number: checkNumber || null,
        payee_id: payeeType !== 'other' ? payeeId : null, payee_type: payeeType !== 'other' ? payeeType : null,
        payee_text: payeeType === 'other' ? payeeText.trim() : null,
        memo: memo || null, lines: lineInputs,
      });
      await queryClient.invalidateQueries({ queryKey: ['checks'] });
      router.replace({ pathname: '/transaction/[id]', params: { id: created.id, type: 'check' } });
    } catch (e) {
      setError(pickErr(e));
    } finally {
      setSaving(false);
    }
  }

  if (bankAccountsQuery.isLoading || accountsQuery.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <AppHeader title="Write Check" leading="back" />
        <LoadingIndicator />
      </View>
    );
  }

  const total = lines.reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Write Check" leading="back" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium, fontSize: typeScale.label, marginBottom: 4 }}>Payee</Text>
        <AppSegmentedControl
          value={payeeType} onChange={setPayeeType}
          options={[{ value: 'vendor', label: 'Vendor' }, { value: 'customer', label: 'Customer' }, { value: 'other', label: 'Other' }]}
        />
        {payeeType === 'other' ? (
          <AppTextInput label="Payee name" value={payeeText} onChangeText={setPayeeText} containerStyle={{ marginTop: spacing.sm, marginBottom: spacing.md }} />
        ) : (
          <View style={{ marginTop: spacing.sm }}>
            <PickerField
              label={payeeType === 'vendor' ? 'Vendor' : 'Customer'}
              value={payeeType === 'vendor' ? (vendor?.name ?? null) : (customer?.name ?? null)}
              onPress={() => setPayeePickerOpen(true)}
            />
          </View>
        )}
        <SearchablePicker
          visible={payeePickerOpen} onDismiss={() => setPayeePickerOpen(false)}
          title={payeeType === 'vendor' ? 'Pick a vendor' : 'Pick a customer'}
          options={(payeeType === 'vendor' ? (vendorsQuery.data ?? []) : (customersQuery.data ?? [])).map(p => ({ id: p.id, label: p.name }))}
          onSelect={setPayeeId}
        />

        <PickerField label="Bank account" value={bankAccount?.name ?? null} onPress={() => setBankPickerOpen(true)} />
        <SearchablePicker
          visible={bankPickerOpen} onDismiss={() => setBankPickerOpen(false)} title="Pick a bank account"
          options={(bankAccountsQuery.data ?? []).map(b => ({ id: b.id, label: b.name }))} onSelect={setBankAccountId}
        />

        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}><DateField label="Payment date" value={paymentDate} onChange={setPaymentDate} /></View>
          <AppTextInput label="Check #" value={checkNumber} onChangeText={setCheckNumber} containerStyle={{ flex: 1 }} placeholder="Auto" />
        </View>

        <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold, fontSize: typeScale.h3, marginTop: spacing.md, marginBottom: spacing.sm }}>Lines</Text>
        {lines.map(line => {
          const account = orderedAccounts.find(a => a.id === line.account_id);
          return (
            <View key={line.key} style={[styles.lineCard, { borderColor: theme.app.border }]}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <PickerField label="Category" value={account ? `${account.code} — ${account.name}` : null} onPress={() => setAccountPickerFor(line.key)} />
                </View>
                {lines.length > 1 ? (
                  <Pressable onPress={() => removeLine(line.key)} hitSlop={8} style={{ marginBottom: spacing.md }}>
                    <MaterialCommunityIcons name="close-circle-outline" size={22} color={theme.app.destructive} />
                  </Pressable>
                ) : null}
              </View>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <AppTextInput
                  label="Description" value={line.description} onChangeText={v => updateLine(line.key, { description: v })}
                  containerStyle={{ flex: 2 }}
                />
                <AppTextInput
                  label="Amount" value={line.amount} onChangeText={v => updateLine(line.key, { amount: v.replace(/[^0-9.]/g, '') })}
                  keyboardType="decimal-pad" left={<Text style={{ color: theme.app.mutedForeground }}>$</Text>} containerStyle={{ flex: 1 }}
                />
              </View>
            </View>
          );
        })}
        <SearchablePicker
          visible={!!accountPickerFor} onDismiss={() => setAccountPickerFor(null)} title="Pick a category"
          options={orderedAccounts.map(a => ({ id: a.id, label: `${a.code} — ${a.name}` }))}
          onSelect={id => { if (accountPickerFor) updateLine(accountPickerFor, { account_id: id }); }}
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
        <AppButton onPress={() => void handleSave()} loading={saving} style={{ flex: 1 }}>Save</AppButton>
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
