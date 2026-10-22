import { useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, router } from 'expo-router';
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
  listIntegrationInbox, getIntegrationInboxSuggestion, listChartOfAccounts,
  categorizeIntegrationRow, excludeIntegrationRow,
} from '../../services/api';
import { pickErr } from '../../services/apiClient';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { ErrorState } from '../../components/ErrorState';
import { fmtMoney, fmtShortDate } from '../../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../../theme';

const BADGE: Record<string, BadgeStatus> = { pending: 'blue', categorized: 'green', matched: 'green', excluded: 'gray' };
const SOURCE_LABEL: Record<string, string> = { stripe_csv: 'Stripe', paypal_csv: 'PayPal', shopify_csv: 'Shopify', generic: 'CSV import' };

/** Vendor-side mirror of app/bank-transaction/[id].tsx — same Categorize/
 * Exclude pattern, but Categorize needs two account pickers here (cash
 * side + offset side), since this row has no bank_account_id to imply
 * one of them the way a bank transaction does. No Match-to-JE UI here
 * either, same scoping reason as the bank transactions screen. */
export default function IntegrationTransactionDetailScreen() {
  const theme = useTheme<AppTheme>();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { activeBusinessId } = useAuth();
  const queryClient = useQueryClient();

  const [cashAccountId, setCashAccountId] = useState<string | null>(null);
  const [cashAccountPickerOpen, setCashAccountPickerOpen] = useState(false);
  const [offsetAccountId, setOffsetAccountId] = useState<string | null>(null);
  const [offsetAccountPickerOpen, setOffsetAccountPickerOpen] = useState(false);
  const [memo, setMemo] = useState('');
  const [excludeReason, setExcludeReason] = useState('');
  const [excluding, setExcluding] = useState(false);
  const [categorizing, setCategorizing] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // No GET-by-id for this entity — list and find, same pattern as
  // Credit Memos/Vendor Credits (confirmed no detail route exists).
  const listQuery = useQuery({
    queryKey: ['integration-inbox-all', activeBusinessId],
    queryFn: () => listIntegrationInbox(activeBusinessId!),
    enabled: !!activeBusinessId,
  });
  const row = listQuery.data?.find(r => r.id === id);

  const coaQuery = useQuery({
    queryKey: ['coa', activeBusinessId],
    queryFn: () => listChartOfAccounts(activeBusinessId!),
    enabled: !!activeBusinessId, staleTime: 5 * 60_000,
  });
  const suggestionQuery = useQuery({
    queryKey: ['integration-inbox-suggestion', activeBusinessId, id],
    queryFn: () => getIntegrationInboxSuggestion(activeBusinessId!, id!),
    enabled: !!activeBusinessId && !!id && row?.status === 'pending',
  });

  const cashAccount = coaQuery.data?.find(a => a.id === cashAccountId);
  const offsetAccount = coaQuery.data?.find(a => a.id === offsetAccountId);
  const suggestedAccount = useMemo(
    () => (suggestionQuery.data ? coaQuery.data?.find(a => a.id === suggestionQuery.data!.account_id) : undefined),
    [suggestionQuery.data, coaQuery.data],
  );

  async function handleCategorize() {
    if (!row || !cashAccountId || !offsetAccountId) return;
    setServerError(null);
    setCategorizing(true);
    try {
      await categorizeIntegrationRow(activeBusinessId!, row.id, { cash_account_id: cashAccountId, offset_account_id: offsetAccountId, memo: memo || null });
      await queryClient.invalidateQueries({ queryKey: ['integration-inbox'] });
      await queryClient.invalidateQueries({ queryKey: ['integration-inbox-all'] });
      router.back();
    } catch (e) {
      setServerError(pickErr(e));
    } finally {
      setCategorizing(false);
    }
  }

  async function handleExclude() {
    if (!row) return;
    if (!excludeReason.trim()) { setServerError('Enter a reason for excluding this transaction.'); return; }
    setServerError(null);
    setExcluding(true);
    try {
      await excludeIntegrationRow(activeBusinessId!, row.id, excludeReason.trim());
      await queryClient.invalidateQueries({ queryKey: ['integration-inbox'] });
      await queryClient.invalidateQueries({ queryKey: ['integration-inbox-all'] });
      router.back();
    } catch (e) {
      setServerError(pickErr(e));
    } finally {
      setExcluding(false);
    }
  }

  if (listQuery.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <AppHeader title="Integration Transaction" leading="back" />
        <LoadingIndicator />
      </View>
    );
  }
  if (listQuery.error || !row) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <AppHeader title="Integration Transaction" leading="back" />
        <ErrorState onRetry={() => void listQuery.refetch()} />
      </View>
    );
  }

  const amount = parseFloat(row.amount);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title={SOURCE_LABEL[row.source] ?? row.source} leading="back" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.amountBlock}>
          <Text style={{ fontSize: typeScale.caption, color: theme.app.mutedForeground }}>{fmtShortDate(row.occurred_at)}</Text>
          <Text style={{ color: amount >= 0 ? theme.app.statusGreenFg : theme.app.foreground, fontSize: 32, fontFamily: fontFamily.bold, marginTop: 2 }}>
            {amount >= 0 ? '+' : '-'}${fmtMoney(Math.abs(amount))}
          </Text>
          <Text style={{ color: theme.app.foreground, marginTop: 4 }}>{row.description}</Text>
          <View style={{ marginTop: 6 }}>
            <StatusBadge status={BADGE[row.status] ?? 'gray'} label={row.status} />
          </View>
        </View>

        {row.status === 'pending' ? (
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
                  label="Cash / clearing account"
                  value={cashAccount ? `${cashAccount.code} — ${cashAccount.name}` : null}
                  placeholder="Pick an account"
                  onPress={() => setCashAccountPickerOpen(true)}
                />
                <SearchablePicker
                  visible={cashAccountPickerOpen}
                  onDismiss={() => setCashAccountPickerOpen(false)}
                  title="Pick the cash/clearing account"
                  options={(coaQuery.data ?? []).map(a => ({ id: a.id, label: `${a.code} — ${a.name}` }))}
                  onSelect={setCashAccountId}
                />
                <PickerField
                  label="Category"
                  value={offsetAccount ? `${offsetAccount.code} — ${offsetAccount.name}` : null}
                  placeholder="Pick an account"
                  onPress={() => setOffsetAccountPickerOpen(true)}
                />
                <SearchablePicker
                  visible={offsetAccountPickerOpen}
                  onDismiss={() => setOffsetAccountPickerOpen(false)}
                  title="Pick a category"
                  options={(coaQuery.data ?? []).map(a => ({ id: a.id, label: `${a.code} — ${a.name}` }))}
                  onSelect={setOffsetAccountId}
                />
                <AppTextInput label="Memo (optional)" value={memo} onChangeText={setMemo} />
                <AppButton onPress={() => void handleCategorize()} loading={categorizing} disabled={!cashAccountId || !offsetAccountId}>
                  Categorize
                </AppButton>
              </View>
            </AppCard>

            <Text style={[styles.sectionTitle, { color: theme.app.foreground }]}>Or exclude it</Text>
            <AppCard style={{ marginBottom: spacing.md }}>
              <View style={{ padding: spacing.md, gap: spacing.sm }}>
                <AppTextInput label="Reason" placeholder="e.g. duplicate, test transaction" value={excludeReason} onChangeText={setExcludeReason} />
                <AppButton variant="outline" onPress={() => void handleExclude()} loading={excluding}>
                  Exclude
                </AppButton>
              </View>
            </AppCard>
          </>
        ) : row.excluded_reason ? (
          <AppCard style={{ padding: spacing.md }}>
            <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>Excluded because</Text>
            <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium, marginTop: 2 }}>{row.excluded_reason}</Text>
          </AppCard>
        ) : null}

        {serverError ? <Text style={{ color: theme.app.destructive, marginTop: spacing.sm }}>{serverError}</Text> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  amountBlock: { alignItems: 'flex-start', marginBottom: spacing.md },
  sectionTitle: { fontSize: typeScale.h3, fontFamily: fontFamily.semibold, marginBottom: spacing.sm, marginTop: spacing.sm },
  suggestionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
});
