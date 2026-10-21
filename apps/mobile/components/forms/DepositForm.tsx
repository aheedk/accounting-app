import { useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, Alert } from 'react-native';
import { Text, TextInput, Button, IconButton, useTheme } from 'react-native-paper';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useAuth } from '../../hooks/useAuth';
import {
  listChartOfAccounts, listBankAccounts, createDeposit, updateDeposit, voidDeposit, deleteDeposit,
  type DepositDetail, type DepositInput, type DepositLineInput,
} from '../../services/api';
import { pickErr } from '../../services/apiClient';
import { statementBankAccounts } from '../../lib/bankAccountOptions';
import { PickerField } from '../PickerField';
import { DateField } from '../DateField';
import { SearchablePicker } from '../SearchablePicker';
import { LoadingIndicator } from '../LoadingIndicator';
import { TransactionFormFooter } from './TransactionFormFooter';
import { fmtMoney } from '../../lib/money';
import { spacing, typeScale, type AppTheme } from '../../theme';

type Line = DepositLineInput & { key: string };
let lineKeySeq = 0;
const newLine = (): Line => ({ key: `l${lineKeySeq++}`, line_type: 'other_funds', account_id: '', description: '', amount: '' });

export function DepositForm({ existing, existingId }: { existing?: DepositDetail; existingId?: string }) {
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

  const [date, setDate] = useState(existing?.deposit_date ?? new Date().toISOString().slice(0, 10));
  const [bankAccountId, setBankAccountId] = useState<string | null>(existing?.bank_account_id ?? null);
  const [memo, setMemo] = useState(existing?.memo ?? '');
  // Undeposited-funds lines are server-controlled and read-only here — the
  // API keeps whatever it already has on update regardless of what's sent,
  // so only other_funds lines are part of the editable state below.
  const undepositedLines = existing?.lines.filter(l => l.line_type === 'undeposited_funds') ?? [];
  const [lines, setLines] = useState<Line[]>(() => {
    const otherFunds = existing?.lines.filter(l => l.line_type === 'other_funds') ?? [];
    return otherFunds.length
      ? otherFunds.map(l => ({ key: `e${l.id}`, line_type: 'other_funds', account_id: l.account_id, description: l.description, amount: l.amount }))
      : [newLine()];
  });

  const [bankAccountPickerOpen, setBankAccountPickerOpen] = useState(false);
  const [accountPickerFor, setAccountPickerFor] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ bankAccount?: string; lines?: string }>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const effectiveExistingId = copied ? undefined : existingId;

  const bankingAccountIds = useMemo(
    () => new Set((bankAccountsQuery.data ?? []).map(b => b.cash_account_id)),
    [bankAccountsQuery.data],
  );
  const bankAccountOptions = useMemo(
    () => statementBankAccounts(coaQuery.data ?? [], bankingAccountIds, ''),
    [coaQuery.data, bankingAccountIds],
  );
  // The deposit's own bank account is picked from bank_accounts, but shown
  // alongside its underlying cash account for the usual code/name label.
  const bankAccountRows = bankAccountsQuery.data ?? [];
  const selectedBankAccount = bankAccountRows.find(b => b.id === bankAccountId);

  const undepositedTotal = undepositedLines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
  const otherFundsTotal = lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
  const total = undepositedTotal + otherFundsTotal;
  const loadingLookups = coaQuery.isLoading || bankAccountsQuery.isLoading;

  function updateLine(key: string, patch: Partial<Line>) {
    setLines(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeLine(key: string) {
    setLines(prev => (prev.length > 1 ? prev.filter(l => l.key !== key) : prev));
  }

  function validate(): typeof fieldErrors {
    const validLines = lines.filter(l => l.account_id && parseFloat(l.amount) > 0);
    const errors: typeof fieldErrors = {};
    if (!bankAccountId) errors.bankAccount = 'Pick a bank account.';
    if (validLines.length === 0 && undepositedLines.length === 0) errors.lines = 'Add at least one line with an account and an amount.';
    else if (total <= 0) errors.lines = 'The deposit total must be greater than zero.';
    return errors;
  }

  async function save() {
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setServerError(null);
    setSaving(true);
    try {
      const body: DepositInput = {
        bank_account_id: bankAccountId!,
        deposit_date: date,
        memo: memo || null,
        lines: lines
          .filter(l => l.account_id && parseFloat(l.amount) > 0)
          .map((l, i) => ({ line_type: 'other_funds', account_id: l.account_id, description: l.description || null, amount: l.amount, sort_order: i })),
      };
      if (effectiveExistingId) await updateDeposit(activeBusinessId!, effectiveExistingId, body);
      else await createDeposit(activeBusinessId!, body);
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
    Alert.alert('Void this deposit?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Void', style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await voidDeposit(activeBusinessId!, existingId);
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
    Alert.alert('Delete this deposit?', 'This permanently removes it. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteDeposit(activeBusinessId!, existingId);
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

      <PickerField
        label="Bank account"
        value={selectedBankAccount ? selectedBankAccount.name : null}
        onPress={() => setBankAccountPickerOpen(true)}
        error={fieldErrors.bankAccount}
      />
      <SearchablePicker
        visible={bankAccountPickerOpen}
        onDismiss={() => setBankAccountPickerOpen(false)}
        title="Pick a bank account"
        options={bankAccountRows
          .filter(b => bankAccountOptions.some(a => a.id === b.cash_account_id))
          .map(b => ({ id: b.id, label: b.name }))}
        onSelect={setBankAccountId}
      />

      {undepositedLines.length > 0 && (
        <View style={{ marginBottom: spacing.md }}>
          <Text style={{ fontSize: typeScale.caption, color: theme.app.mutedForeground, marginBottom: spacing.xs }}>
            From undeposited funds (not editable here)
          </Text>
          {undepositedLines.map(l => (
            <View key={l.id} style={[styles.readOnlyLine, { borderColor: theme.app.border, backgroundColor: theme.app.page }]}>
              <Text style={{ color: theme.app.foreground, flex: 1 }} numberOfLines={1}>{l.received_from ?? l.account_name ?? 'Payment'}</Text>
              <Text style={{ color: theme.app.foreground, fontWeight: '600' }}>${fmtMoney(l.amount)}</Text>
            </View>
          ))}
        </View>
      )}

      <Text style={[styles.sectionTitle, { color: theme.app.foreground }]}>Other funds</Text>
      {fieldErrors.lines ? (
        <Text style={{ color: theme.app.destructive, fontSize: typeScale.caption, marginBottom: spacing.sm }}>{fieldErrors.lines}</Text>
      ) : null}
      {lines.map(line => {
        const account = coaQuery.data?.find(a => a.id === line.account_id);
        return (
          <View key={line.key} style={[styles.lineCard, { borderColor: theme.app.border, backgroundColor: theme.app.surface }]}>
            <View style={styles.lineHeader}>
              <View style={{ flex: 1 }}>
                <PickerField
                  label="Account"
                  value={account ? `${account.code} — ${account.name}` : null}
                  onPress={() => setAccountPickerFor(line.key)}
                />
              </View>
              <IconButton icon="trash-can-outline" size={20} onPress={() => removeLine(line.key)} disabled={lines.length === 1} />
            </View>
            <SearchablePicker
              visible={accountPickerFor === line.key}
              onDismiss={() => setAccountPickerFor(null)}
              title="Pick an account"
              options={(coaQuery.data ?? []).map(a => ({ id: a.id, label: `${a.code} — ${a.name}` }))}
              onSelect={(id) => updateLine(line.key, { account_id: id })}
            />
            <TextInput
              mode="outlined"
              placeholder="Description (optional)"
              value={line.description ?? ''}
              onChangeText={(v) => updateLine(line.key, { description: v })}
              dense
              style={{ marginBottom: spacing.sm, backgroundColor: theme.app.surface }}
            />
            <TextInput
              mode="outlined"
              placeholder="0.00"
              value={line.amount}
              onChangeText={(v) => updateLine(line.key, { amount: v.replace(/[^0-9.]/g, '') })}
              keyboardType="decimal-pad"
              dense
              left={<TextInput.Affix text="$" />}
              style={{ backgroundColor: theme.app.surface }}
            />
          </View>
        );
      })}
      <Button mode="outlined" icon="plus" onPress={() => setLines(prev => [...prev, newLine()])} style={{ marginBottom: spacing.md }}>
        Add line
      </Button>

      <TextInput
        mode="outlined"
        label="Memo"
        value={memo}
        onChangeText={setMemo}
        multiline
        style={{ marginBottom: spacing.lg, backgroundColor: theme.app.surface }}
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
        saveLabel={effectiveExistingId ? 'Save changes' : 'Save deposit'}
        onSave={() => void save()}
        onCopy={existingId ? () => setCopied(true) : undefined}
        onVoid={existingId ? () => void handleVoid() : undefined}
        onDelete={existingId ? () => void handleDelete() : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md },
  sectionTitle: { fontSize: typeScale.h2, fontWeight: '700', marginBottom: spacing.sm },
  lineCard: { borderWidth: 1, borderRadius: 10, padding: spacing.sm, marginBottom: spacing.sm },
  lineHeader: { flexDirection: 'row', alignItems: 'flex-start' },
  readOnlyLine: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 8,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, marginBottom: spacing.xs,
  },
  totalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, marginBottom: spacing.md,
  },
});
