import { useEffect, useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { AppChip } from '../components/ui/AppChip';
import { AppMenu, AppMenuItem } from '../components/ui/AppMenu';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { StatusBadge, type BadgeStatus } from '../components/ui/StatusBadge';
import { listBankAccounts, listBankTransactions, type BankTransactionRow, type BankTransactionStatus } from '../services/api';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { fmtMoney, fmtShortDate } from '../lib/money';
import { spacing, typeScale, fontFamily, minTouchTarget, type AppTheme } from '../theme';

type StatusFilter = 'unreviewed' | 'categorized' | 'excluded' | 'matched';
const FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'unreviewed', label: 'For review' }, { value: 'categorized', label: 'Categorized' },
  { value: 'matched', label: 'Matched' }, { value: 'excluded', label: 'Excluded' },
];

const BT_BADGE: Record<string, BadgeStatus> = { unreviewed: 'blue', categorized: 'green', matched: 'green', excluded: 'gray' };

/**
 * The bank-feed triage inbox — rows waiting to become journal entries,
 * not the Cash Activity ledger report and not Reconciliation (a
 * separate, not-yet-built worksheet). One bank account at a time, same
 * as web's per-account card selector, since a transaction's own balance
 * context only makes sense within one account.
 */
export default function BankTransactionsScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { activeBusinessId } = useAuth();
  const [bankAccountId, setBankAccountId] = useState<string | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>('unreviewed');

  const bankAccountsQuery = useQuery({
    queryKey: ['bank-accounts', activeBusinessId],
    queryFn: () => listBankAccounts(activeBusinessId!),
    enabled: !!activeBusinessId, staleTime: 5 * 60_000,
  });
  useEffect(() => {
    if (!bankAccountId && bankAccountsQuery.data?.length) setBankAccountId(bankAccountsQuery.data[0]!.id);
  }, [bankAccountId, bankAccountsQuery.data]);

  const txnsQuery = useQuery({
    queryKey: ['bank-transactions', activeBusinessId, bankAccountId, filter],
    queryFn: () => listBankTransactions(activeBusinessId!, { bank_account_id: bankAccountId!, status: filter as BankTransactionStatus }),
    enabled: !!activeBusinessId && !!bankAccountId,
  });

  const selectedAccount = bankAccountsQuery.data?.find(a => a.id === bankAccountId);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Bank Transactions" />

      <View style={styles.filterBar}>
        {bankAccountsQuery.isLoading ? null : (bankAccountsQuery.data ?? []).length === 0 ? (
          <Text style={{ color: theme.app.mutedForeground }}>No bank accounts set up.</Text>
        ) : (
          <AppMenu
            visible={accountMenuOpen}
            onDismiss={() => setAccountMenuOpen(false)}
            anchor={
              <Pressable onPress={() => setAccountMenuOpen(true)} style={[styles.accountField, { borderColor: theme.app.border, backgroundColor: theme.app.surface }]}>
                <MaterialCommunityIcons name="bank-outline" size={18} color={theme.app.mutedForeground} />
                <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium, flex: 1, marginLeft: spacing.sm }} numberOfLines={1}>
                  {selectedAccount?.name ?? 'Pick an account'}
                </Text>
                <MaterialCommunityIcons name="chevron-down" size={18} color={theme.app.mutedForeground} />
              </Pressable>
            }
          >
            {(bankAccountsQuery.data ?? []).map(a => (
              <AppMenuItem key={a.id} title={a.name} onPress={() => { setBankAccountId(a.id); setAccountMenuOpen(false); }} />
            ))}
          </AppMenu>
        )}

        <View style={styles.chipRow}>
          {FILTERS.map(f => (
            <AppChip key={f.value} label={f.label} active={filter === f.value} onPress={() => setFilter(f.value)} style={{ marginRight: spacing.xs, marginBottom: spacing.xs }} />
          ))}
        </View>
      </View>

      {!bankAccountId ? (
        <EmptyState icon="bank-outline" message="Pick a bank account to review its transactions." />
      ) : txnsQuery.isLoading ? (
        <LoadingIndicator />
      ) : txnsQuery.error ? (
        <ErrorState onRetry={() => void txnsQuery.refetch()} />
      ) : (
        <FlashList
          data={txnsQuery.data ?? []}
          keyExtractor={t => t.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
          ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.app.border }} />}
          ListEmptyComponent={<EmptyState icon="bank-check" message="Nothing here." />}
          renderItem={({ item }: { item: BankTransactionRow }) => <TxnRow row={item} theme={theme} />}
        />
      )}
    </View>
  );
}

function TxnRow({ row, theme }: { row: BankTransactionRow; theme: AppTheme }) {
  const amount = parseFloat(row.amount);
  return (
    <Pressable
      style={({ pressed }) => [styles.row, { minHeight: minTouchTarget + 16, opacity: pressed ? 0.6 : 1 }]}
      onPress={() => router.push({ pathname: '/bank-transaction/[id]', params: { id: row.id } })}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold, fontSize: typeScale.body }} numberOfLines={1}>
          {row.description}
        </Text>
        <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>
          {fmtShortDate(row.transaction_date)}{row.is_reconciled ? ' · Reconciled' : ''}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <Text style={{ color: amount >= 0 ? theme.app.statusGreenFg : theme.app.foreground, fontFamily: fontFamily.semibold, fontSize: typeScale.body }}>
          {amount >= 0 ? '+' : '-'}${fmtMoney(Math.abs(amount))}
        </Text>
        <StatusBadge status={BT_BADGE[row.status] ?? 'gray'} label={row.status === 'unreviewed' ? 'For review' : row.status} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  filterBar: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm, gap: spacing.sm },
  accountField: { flexDirection: 'row', alignItems: 'center', minHeight: minTouchTarget, borderWidth: 1, borderRadius: 6, paddingHorizontal: spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
