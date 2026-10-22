import { View, StyleSheet } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { AppCard } from '../components/ui/AppCard';
import { StatusBadge } from '../components/ui/StatusBadge';
import { listBankAccountsFull, type BankAccountFull } from '../services/api';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { fmtMoney } from '../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../theme';

/** Read-only: create/deactivate are firm_admin-only, low-frequency setup
 * actions not built this chunk. Shows both the bank-feed balance (what's
 * been imported) and the book balance (what the ledger holds) side by
 * side — they're expected to differ until reconciled, not a bug. */
export default function BankAccountsScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { activeBusinessId } = useAuth();

  const query = useQuery({
    queryKey: ['bank-accounts-full', activeBusinessId],
    queryFn: () => listBankAccountsFull(activeBusinessId!),
    enabled: !!activeBusinessId,
  });

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Bank Accounts" />

      {query.isLoading ? (
        <LoadingIndicator />
      ) : query.error ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <FlashList
          data={query.data ?? []}
          keyExtractor={a => a.id}
          contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + spacing.xxl }}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          ListEmptyComponent={<EmptyState icon="bank-outline" message="No bank accounts set up." />}
          renderItem={({ item }: { item: BankAccountFull }) => <AccountCard account={item} theme={theme} />}
        />
      )}
    </View>
  );
}

function AccountCard({ account, theme }: { account: BankAccountFull; theme: AppTheme }) {
  return (
    <AppCard style={{ padding: spacing.md }}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold, fontSize: typeScale.body }} numberOfLines={1}>
            {account.name}
          </Text>
          <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }} numberOfLines={1}>
            {account.institution ?? 'No institution'}{account.account_last_four ? ` · ···${account.account_last_four}` : ''}
          </Text>
        </View>
        <StatusBadge status={account.is_active ? 'green' : 'gray'} label={account.is_active ? 'Active' : 'Inactive'} />
      </View>
      <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption, marginTop: spacing.sm }}>
        {account.cash_account_code} — {account.cash_account_name}
      </Text>
      <View style={[styles.balanceRow, { borderTopColor: theme.app.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>Bank balance</Text>
          <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold }}>${fmtMoney(account.bank_balance)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>Book balance</Text>
          <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold }}>${fmtMoney(account.book_balance)}</Text>
        </View>
      </View>
    </AppCard>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  balanceRow: { flexDirection: 'row', marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
});
