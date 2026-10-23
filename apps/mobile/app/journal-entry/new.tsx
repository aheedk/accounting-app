import { useEffect, useState } from 'react';
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
import { PickerField } from '../../components/PickerField';
import { SearchablePicker } from '../../components/SearchablePicker';
import { DateField } from '../../components/DateField';
import { listChartOfAccounts, getNextJournalNumber, createJournalEntry, type JournalLineInput } from '../../services/api';
import { pickErr } from '../../services/apiClient';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { fmtMoney } from '../../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../../theme';

const todayIso = () => new Date().toISOString().slice(0, 10);

type DraftLine = { key: string; account_id: string | null; side: 'debit' | 'credit'; amount: string; memo: string };

export default function NewJournalEntryScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { activeBusinessId } = useAuth();
  const queryClient = useQueryClient();

  const [entryDate, setEntryDate] = useState(todayIso());
  const [journalNumber, setJournalNumber] = useState('');
  const [memo, setMemo] = useState('');
  const [reference, setReference] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([
    { key: '1', account_id: null, side: 'debit', amount: '', memo: '' },
    { key: '2', account_id: null, side: 'credit', amount: '', memo: '' },
  ]);
  const [accountPickerFor, setAccountPickerFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const accountsQuery = useQuery({
    queryKey: ['coa', activeBusinessId],
    queryFn: () => listChartOfAccounts(activeBusinessId!),
    enabled: !!activeBusinessId, staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!activeBusinessId) return;
    void getNextJournalNumber(activeBusinessId).then(n => { if (n) setJournalNumber(n); });
  }, [activeBusinessId]);

  function addLine() {
    setLines(prev => [...prev, { key: String(Date.now()), account_id: null, side: 'debit', amount: '', memo: '' }]);
  }
  function removeLine(key: string) {
    setLines(prev => prev.filter(l => l.key !== key));
  }
  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)));
  }

  const totalDebit = lines.filter(l => l.side === 'debit').reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0);
  const totalCredit = lines.filter(l => l.side === 'credit').reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.005 && totalDebit > 0;

  async function handleSave() {
    const validLines = lines.filter(l => l.account_id && parseFloat(l.amount) > 0);
    if (validLines.length < 2) { setError('At least two lines are required.'); return; }
    if (!balanced) { setError('Total debits must equal total credits.'); return; }
    setError(null);
    setSaving(true);
    try {
      const lineInputs: JournalLineInput[] = validLines.map(l => ({
        account_id: l.account_id!,
        debit: l.side === 'debit' ? l.amount : '0',
        credit: l.side === 'credit' ? l.amount : '0',
        memo: l.memo || null,
      }));
      const created = await createJournalEntry(activeBusinessId!, {
        entry_date: entryDate, journal_number: journalNumber || null, memo: memo || null, reference: reference || null, lines: lineInputs,
      });
      await queryClient.invalidateQueries({ queryKey: ['journal-entries'] });
      router.replace({ pathname: '/transaction/[id]', params: { id: created.id, type: 'journal' } });
    } catch (e) {
      setError(pickErr(e));
    } finally {
      setSaving(false);
    }
  }

  if (accountsQuery.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <AppHeader title="New Journal Entry" leading="back" />
        <LoadingIndicator />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="New Journal Entry" leading="back" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}><DateField label="Entry date" value={entryDate} onChange={setEntryDate} /></View>
          <AppTextInput label="Journal #" value={journalNumber} onChangeText={setJournalNumber} containerStyle={{ flex: 1 }} placeholder="Auto" />
        </View>

        <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold, fontSize: typeScale.h3, marginTop: spacing.md, marginBottom: spacing.sm }}>Lines</Text>
        {lines.map(line => {
          const account = accountsQuery.data?.find(a => a.id === line.account_id);
          return (
            <View key={line.key} style={[styles.lineCard, { borderColor: theme.app.border }]}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <PickerField label="Account" value={account ? `${account.code} — ${account.name}` : null} onPress={() => setAccountPickerFor(line.key)} />
                </View>
                {lines.length > 2 ? (
                  <Pressable onPress={() => removeLine(line.key)} hitSlop={8} style={{ marginBottom: spacing.md }}>
                    <MaterialCommunityIcons name="close-circle-outline" size={22} color={theme.app.destructive} />
                  </Pressable>
                ) : null}
              </View>
              <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' }}>
                <Pressable
                  onPress={() => updateLine(line.key, { side: line.side === 'debit' ? 'credit' : 'debit' })}
                  style={[styles.sideToggle, { borderColor: theme.app.border, backgroundColor: theme.app.muted }]}
                >
                  <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium }}>{line.side === 'debit' ? 'Debit' : 'Credit'}</Text>
                  <MaterialCommunityIcons name="swap-horizontal" size={16} color={theme.app.mutedForeground} />
                </Pressable>
                <AppTextInput
                  label="Amount" value={line.amount} onChangeText={v => updateLine(line.key, { amount: v.replace(/[^0-9.]/g, '') })}
                  keyboardType="decimal-pad" left={<Text style={{ color: theme.app.mutedForeground }}>$</Text>} containerStyle={{ flex: 1 }}
                />
              </View>
              <AppTextInput label="Memo" value={line.memo} onChangeText={v => updateLine(line.key, { memo: v })} />
            </View>
          );
        })}
        <SearchablePicker
          visible={!!accountPickerFor} onDismiss={() => setAccountPickerFor(null)} title="Pick an account"
          options={(accountsQuery.data ?? []).map(a => ({ id: a.id, label: `${a.code} — ${a.name}` }))}
          onSelect={id => { if (accountPickerFor) updateLine(accountPickerFor, { account_id: id }); }}
        />
        <AppButton variant="outline" onPress={addLine} style={{ marginBottom: spacing.md }}>Add line</AppButton>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.md }}>
          <Text style={{ color: theme.app.mutedForeground }}>Debits ${fmtMoney(String(totalDebit))} · Credits ${fmtMoney(String(totalCredit))}</Text>
          <Text style={{ color: balanced ? theme.app.statusGreenFg : theme.app.statusRedFg, fontFamily: fontFamily.semibold }}>
            {balanced ? 'Balanced' : 'Out of balance'}
          </Text>
        </View>

        <AppTextInput label="Memo" value={memo} onChangeText={setMemo} containerStyle={{ marginBottom: spacing.md }} />
        <AppTextInput label="Reference" value={reference} onChangeText={setReference} containerStyle={{ marginBottom: spacing.lg }} />

        {error ? <Text style={{ color: theme.app.destructive, marginBottom: spacing.sm }}>{error}</Text> : null}
      </ScrollView>

      <View style={[styles.footer, { borderColor: theme.app.border, backgroundColor: theme.app.surface, paddingBottom: insets.bottom + spacing.sm }]}>
        <AppButton variant="outline" onPress={() => router.back()}>Cancel</AppButton>
        <AppButton onPress={() => void handleSave()} loading={saving} disabled={!balanced} style={{ flex: 1 }}>Save</AppButton>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md },
  lineCard: { borderWidth: 1, borderRadius: 8, padding: spacing.sm, marginBottom: spacing.sm, gap: spacing.sm },
  sideToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 8, paddingHorizontal: spacing.sm, height: 40 },
  footer: {
    flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
