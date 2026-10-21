import { View, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../hooks/useAuth';
import { AppHeader } from '../../components/AppHeader';
import { AppCard } from '../../components/ui/AppCard';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { getAccount, getAccountRegister, type AccountRegisterRow } from '../../services/api';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { ErrorState } from '../../components/ErrorState';
import { EmptyState } from '../../components/EmptyState';
import { fmtMoney, fmtShortDate } from '../../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../../theme';

export default function AccountDetailScreen() {
  const theme = useTheme<AppTheme>();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { activeBusinessId } = useAuth();

  const accountQuery = useQuery({
    queryKey: ['coa-account', activeBusinessId, id],
    queryFn: () => getAccount(activeBusinessId!, id!),
    enabled: !!activeBusinessId && !!id,
  });
  const registerQuery = useQuery({
    queryKey: ['coa-account-register', activeBusinessId, id],
    queryFn: () => getAccountRegister(activeBusinessId!, id!),
    enabled: !!activeBusinessId && !!id,
  });

  if (accountQuery.isLoading || registerQuery.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <AppHeader title="Account" leading="back" />
        <LoadingIndicator />
      </View>
    );
  }
  if (accountQuery.error || !accountQuery.data) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <AppHeader title="Account" leading="back" />
        <ErrorState onRetry={() => void accountQuery.refetch()} />
      </View>
    );
  }

  const account = accountQuery.data;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title={account.name} leading="back" />

      <ScrollView contentContainerStyle={styles.content}>
        <AppCard style={{ marginBottom: spacing.md }}>
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption, textTransform: 'capitalize' }}>
                {account.code} · {account.account_type}{account.detail_type ? ` · ${account.detail_type}` : ''}
              </Text>
              {account.description ? (
                <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption, marginTop: 4 }}>{account.description}</Text>
              ) : null}
            </View>
            <StatusBadge status={account.is_active ? 'green' : 'gray'} label={account.is_active ? 'Active' : 'Inactive'} />
          </View>
          <View style={[styles.balanceRow, { borderTopColor: theme.app.border }]}>
            <Text style={{ color: theme.app.mutedForeground, fontFamily: fontFamily.medium }}>Current balance</Text>
            <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.bold, fontSize: typeScale.h3 }}>
              ${fmtMoney(account.balance)}
            </Text>
          </View>
        </AppCard>

        <Text style={{ fontSize: typeScale.h3, fontFamily: fontFamily.semibold, color: theme.app.foreground, marginBottom: spacing.sm }}>
          Recent activity
        </Text>
        {registerQuery.data && registerQuery.data.rows.length > 0 ? (
          <AppCard>
            {registerQuery.data.rows.map((row, i) => (
              <RegisterRow key={row.line_id} row={row} theme={theme} last={i === registerQuery.data!.rows.length - 1} />
            ))}
          </AppCard>
        ) : (
          <EmptyState icon="book-open-outline" message="No activity on this account yet." compact />
        )}
      </ScrollView>
    </View>
  );
}

function RegisterRow({ row, theme, last }: { row: AccountRegisterRow; theme: AppTheme; last: boolean }) {
  const amount = parseFloat(row.debit) - parseFloat(row.credit);
  return (
    <Pressable
      style={[styles.lineRow, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.app.border }]}
      onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: row.journal_entry_id, type: 'journal' } })}
    >
      <View style={styles.lineTop}>
        <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>{fmtShortDate(row.entry_date)}</Text>
        <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }} numberOfLines={1}>{row.source_type}{row.reference ? ` #${row.reference}` : ''}</Text>
      </View>
      <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold }} numberOfLines={2}>
        {row.memo ?? row.counter_account ?? '—'}
      </Text>
      {row.is_voided && <View style={{ marginTop: 2 }}><StatusBadge status="red" label="Voided" /></View>}
      <View style={styles.lineBottom}>
        <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }} numberOfLines={1}>
          {row.counter_account ?? '–Split–'}
        </Text>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: amount >= 0 ? theme.app.statusGreenFg : theme.app.statusRedFg, fontFamily: fontFamily.bold }}>
            {amount >= 0 ? '' : '-'}${fmtMoney(Math.abs(amount))}
          </Text>
          <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>Bal ${fmtMoney(row.balance)}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: spacing.md, gap: spacing.sm },
  balanceRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth,
  },
  lineRow: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  lineTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  lineBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: spacing.xs },
});
