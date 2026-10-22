import { useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, Alert } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, router } from 'expo-router';
import { hasMinRole, type Role } from '@accounting/shared';
import { useAuth } from '../../hooks/useAuth';
import { AppHeader } from '../../components/AppHeader';
import { AppCard } from '../../components/ui/AppCard';
import { AppButton } from '../../components/ui/AppButton';
import { AppTextInput } from '../../components/ui/AppTextInput';
import { StatusBadge, type BadgeStatus } from '../../components/ui/StatusBadge';
import { ConfidenceBadge } from '../../components/ConfidenceBadge';
import { PickerField } from '../../components/PickerField';
import { SearchablePicker } from '../../components/SearchablePicker';
import {
  getBankTransaction, getBankTransactionSuggestion, listBankAccounts, listChartOfAccounts,
  categorizeBankTransaction, excludeBankTransaction, unreviewBankTransaction,
} from '../../services/api';
import { pickErr } from '../../services/apiClient';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { ErrorState } from '../../components/ErrorState';
import { fmtMoney, fmtShortDate } from '../../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../../theme';

const BT_BADGE: Record<string, BadgeStatus> = { unreviewed: 'blue', categorized: 'green', matched: 'green', excluded: 'gray' };

export default function BankTransactionDetailScreen() {
  const theme = useTheme<AppTheme>();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { activeBusinessId, businesses, user } = useAuth();
  const queryClient = useQueryClient();

  const [offsetAccountId, setOffsetAccountId] = useState<string | null>(null);
  const [offsetAccountPickerOpen, setOffsetAccountPickerOpen] = useState(false);
  const [memo, setMemo] = useState('');
  const [excludeReason, setExcludeReason] = useState('');
  const [excluding, setExcluding] = useState(false);
  const [categorizing, setCategorizing] = useState(false);
  const [unreviewing, setUnreviewing] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const effectiveRole = (businesses.find(b => b.id === activeBusinessId)?.role_override ?? user?.role ?? 'viewer') as Role;
  const canUnreview = hasMinRole(effectiveRole, 'accountant');

  const txnQuery = useQuery({
    queryKey: ['bank-transaction', activeBusinessId, id],
    queryFn: () => getBankTransaction(activeBusinessId!, id!),
    enabled: !!activeBusinessId && !!id,
  });
  const txn = txnQuery.data;

  const bankAccountsQuery = useQuery({
    queryKey: ['bank-accounts', activeBusinessId],
    queryFn: () => listBankAccounts(activeBusinessId!),
    enabled: !!activeBusinessId, staleTime: 5 * 60_000,
  });
  const coaQuery = useQuery({
    queryKey: ['coa', activeBusinessId],
    queryFn: () => listChartOfAccounts(activeBusinessId!),
    enabled: !!activeBusinessId, staleTime: 5 * 60_000,
  });
  const suggestionQuery = useQuery({
    queryKey: ['bank-transaction-suggestion', activeBusinessId, id],
    queryFn: () => getBankTransactionSuggestion(activeBusinessId!, id!),
    enabled: !!activeBusinessId && !!id && txn?.status === 'unreviewed',
  });

  const offsetAccount = coaQuery.data?.find(a => a.id === offsetAccountId);
  const bankAccount = bankAccountsQuery.data?.find(a => a.id === txn?.bank_account_id);
  const suggestedAccount = useMemo(
    () => (suggestionQuery.data ? coaQuery.data?.find(a => a.id === suggestionQuery.data!.account_id) : undefined),
    [suggestionQuery.data, coaQuery.data],
  );

  async function handleCategorize() {
    if (!txn || !offsetAccountId) return;
    setServerError(null);
    setCategorizing(true);
    try {
      await categorizeBankTransaction(activeBusinessId!, txn.id, { offset_account_id: offsetAccountId, memo: memo || null });
      await queryClient.invalidateQueries({ queryKey: ['bank-transactions'] });
      await queryClient.invalidateQueries({ queryKey: ['bank-transaction'] });
      router.back();
    } catch (e) {
      setServerError(pickErr(e));
    } finally {
      setCategorizing(false);
    }
  }

  async function handleExclude() {
    if (!txn) return;
    if (!excludeReason.trim()) { setServerError('Enter a reason for excluding this transaction.'); return; }
    setServerError(null);
    setExcluding(true);
    try {
      await excludeBankTransaction(activeBusinessId!, txn.id, excludeReason.trim());
      await queryClient.invalidateQueries({ queryKey: ['bank-transactions'] });
      await queryClient.invalidateQueries({ queryKey: ['bank-transaction'] });
      router.back();
    } catch (e) {
      setServerError(pickErr(e));
    } finally {
      setExcluding(false);
    }
  }

  function handleUnreview() {
    if (!txn) return;
    Alert.alert('Move back to "For review"?', 'This undoes how this transaction was coded.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Undo', style: 'destructive',
        onPress: () => {
          void (async () => {
            setUnreviewing(true);
            try {
              await unreviewBankTransaction(activeBusinessId!, txn.id);
              await queryClient.invalidateQueries({ queryKey: ['bank-transactions'] });
              await queryClient.invalidateQueries({ queryKey: ['bank-transaction'] });
              router.back();
            } catch (e) {
              setServerError(pickErr(e));
            } finally {
              setUnreviewing(false);
            }
          })();
        },
      },
    ]);
  }

  if (txnQuery.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <AppHeader title="Bank Transaction" leading="back" />
        <LoadingIndicator />
      </View>
    );
  }
  if (txnQuery.error || !txn) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <AppHeader title="Bank Transaction" leading="back" />
        <ErrorState onRetry={() => void txnQuery.refetch()} />
      </View>
    );
  }

  const amount = parseFloat(txn.amount);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title={bankAccount?.name ?? 'Bank Transaction'} leading="back" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.amountBlock}>
          <Text style={{ fontSize: typeScale.caption, color: theme.app.mutedForeground }}>{fmtShortDate(txn.transaction_date)}</Text>
          <Text style={{ color: amount >= 0 ? theme.app.statusGreenFg : theme.app.foreground, fontSize: 32, fontFamily: fontFamily.bold, marginTop: 2 }}>
            {amount >= 0 ? '+' : '-'}${fmtMoney(Math.abs(amount))}
          </Text>
          <Text style={{ color: theme.app.foreground, marginTop: 4 }}>{txn.description}</Text>
          <View style={{ marginTop: 6 }}>
            <StatusBadge status={BT_BADGE[txn.status] ?? 'gray'} label={txn.status === 'unreviewed' ? 'For review' : txn.status} />
          </View>
        </View>

        {txn.status === 'unreviewed' ? (
          <>
            <Text style={[styles.sectionTitle, { color: theme.app.foreground }]}>Categorize</Text>
            <AppCard style={{ marginBottom: spacing.md }}>
              <View style={{ padding: spacing.md, gap: spacing.sm }}>
                {suggestionQuery.data ? (
                  <View style={styles.suggestionRow}>
                    <ConfidenceBadge suggestion={suggestionQuery.data} />
                    {suggestedAccount && !offsetAccountId ? (
                      <AppButton variant="link" onPress={() => setOffsetAccountId(suggestedAccount.id)}>
                        {`Use ${suggestedAccount.code} — ${suggestedAccount.name}`}
                      </AppButton>
                    ) : null}
                  </View>
                ) : null}
                <PickerField
                  label="Category"
                  value={offsetAccount ? `${offsetAccount.code} — ${offsetAccount.name}` : null}
                  placeholder="Pick an account"
                  onPress={() => setOffsetAccountPickerOpen(true)}
                />
                <SearchablePicker
                  visible={offsetAccountPickerOpen}
                  onDismiss={() => setOffsetAccountPickerOpen(false)}
                  title="Pick an account"
                  options={(coaQuery.data ?? []).map(a => ({ id: a.id, label: `${a.code} — ${a.name}` }))}
                  onSelect={setOffsetAccountId}
                />
                <AppTextInput label="Memo (optional)" value={memo} onChangeText={setMemo} />
                <AppButton onPress={() => void handleCategorize()} loading={categorizing} disabled={!offsetAccountId}>
                  Categorize
                </AppButton>
              </View>
            </AppCard>

            <Text style={[styles.sectionTitle, { color: theme.app.foreground }]}>Or exclude it</Text>
            <AppCard style={{ marginBottom: spacing.md }}>
              <View style={{ padding: spacing.md, gap: spacing.sm }}>
                <AppTextInput label="Reason" placeholder="e.g. personal transaction, duplicate" value={excludeReason} onChangeText={setExcludeReason} />
                <AppButton variant="outline" onPress={() => void handleExclude()} loading={excluding}>
                  Exclude
                </AppButton>
              </View>
            </AppCard>
          </>
        ) : (
          <AppCard style={{ marginBottom: spacing.md }}>
            {txn.excluded_reason ? (
              <FieldRow label="Excluded because" value={txn.excluded_reason} theme={theme} last />
            ) : (
              <FieldRow label="Reviewed" value={txn.reviewed_at ? fmtShortDate(txn.reviewed_at) : '—'} theme={theme} last />
            )}
          </AppCard>
        )}

        {serverError ? <Text style={{ color: theme.app.destructive, marginTop: spacing.sm }}>{serverError}</Text> : null}

        {canUnreview && txn.status !== 'unreviewed' && !txn.is_reconciled ? (
          <AppButton variant="outline" onPress={handleUnreview} loading={unreviewing} style={{ marginTop: spacing.lg }}>
            Move back to "For review"
          </AppButton>
        ) : null}
      </ScrollView>
    </View>
  );
}

function FieldRow({ label, value, theme, last }: { label: string; value: string; theme: AppTheme; last?: boolean }) {
  return (
    <View style={[styles.fieldRow, last && { marginBottom: 0 }]}>
      <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>{label}</Text>
      <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium, marginTop: 1 }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  amountBlock: { alignItems: 'flex-start', marginBottom: spacing.md },
  sectionTitle: { fontSize: typeScale.h3, fontFamily: fontFamily.semibold, marginBottom: spacing.sm, marginTop: spacing.sm },
  suggestionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  fieldRow: { padding: spacing.md, marginBottom: spacing.xs },
});
