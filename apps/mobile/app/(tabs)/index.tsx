import { useMemo } from 'react';
import { View, StyleSheet, RefreshControl, ScrollView } from 'react-native';
import { Text, Card, Avatar, useTheme } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../hooks/useAuth';
import { listTransactions, listInvoices, listPendingInbox } from '../../services/api';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { ErrorState } from '../../components/ErrorState';
import { fmtMoney, fmtShortDate } from '../../lib/money';
import { isInflowType } from '../../lib/transactions';
import { spacing, typeScale, type AppTheme } from '../../theme';

const TX_TYPE_LABELS: Record<string, string> = {
  deposit: 'Deposit', expense: 'Expense', check: 'Check', journal: 'Journal Entry',
  bill: 'Bill', payment: 'Payment', credit_memo: 'Credit Memo',
  invoice: 'Invoice', bill_payment: 'Bill Payment', vendor_credit: 'Vendor Credit',
};

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function DashboardScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { businesses, activeBusinessId } = useAuth();
  const activeBusiness = businesses.find(b => b.id === activeBusinessId);

  const recentTx = useQuery({
    queryKey: ['transactions', activeBusinessId, { recent: true }],
    queryFn: () => listTransactions(activeBusinessId!, { limit: 6 }),
    enabled: !!activeBusinessId,
  });
  const invoices = useQuery({
    queryKey: ['invoices', activeBusinessId],
    queryFn: () => listInvoices(activeBusinessId!),
    enabled: !!activeBusinessId,
    staleTime: 5 * 60_000, // item 7: invoices don't need to be as fresh as a transaction feed
  });
  const inbox = useQuery({
    queryKey: ['inbox-pending', activeBusinessId],
    queryFn: () => listPendingInbox(activeBusinessId!),
    enabled: !!activeBusinessId,
  });

  const overdue = useMemo(() => {
    if (!invoices.data) return { count: 0, total: 0 };
    const today = todayIso();
    const rows = invoices.data.filter(i => i.status === 'posted' && i.due_date < today);
    // Approximate: this sums each overdue invoice's full total, not total
    // less what's already been applied against it (the unified transactions
    // endpoint's own `balance` field does that math, but isn't available
    // per-invoice here without a second round trip). Good enough for a
    // dashboard count; the real amount-due figure is the Invoice list/detail
    // screen's job, not this card's.
    return { count: rows.length, total: rows.reduce((s, i) => s + parseFloat(i.total), 0) };
  }, [invoices.data]);

  const loading = recentTx.isLoading || invoices.isLoading || inbox.isLoading;
  const anyError = recentTx.error ?? invoices.error ?? inbox.error;
  const refreshing = recentTx.isFetching || invoices.isFetching || inbox.isFetching;

  function refresh() {
    void recentTx.refetch();
    void invoices.refetch();
    void inbox.refetch();
  }

  if (!activeBusinessId) {
    return (
      <View style={styles.centered}>
        <Text>Pick a business to get started.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md }]}
      refreshControl={<RefreshControl refreshing={!loading && refreshing} onRefresh={refresh} tintColor={theme.app.primary} />}
    >
      <View style={styles.header}>
        <Text style={{ fontSize: typeScale.caption, color: theme.app.mutedForeground }}>VIEWING</Text>
        <Text style={{ fontSize: typeScale.h1, fontWeight: '700', color: theme.app.foreground }}>{activeBusiness?.name ?? '—'}</Text>
      </View>

      {loading ? (
        <LoadingIndicator />
      ) : anyError ? (
        <ErrorState onRetry={refresh} />
      ) : (
        <>
          <View style={styles.cardsRow}>
            <SummaryCard
              theme={theme}
              icon="file-document-alert"
              tint={theme.app.statusRedFg}
              tintBg={theme.app.statusRedBg}
              label="Overdue invoices"
              value={String(overdue.count)}
              sub={`$${fmtMoney(overdue.total)}`}
              onPress={() => router.push('/(tabs)/clients')}
            />
            <SummaryCard
              theme={theme}
              icon="inbox-arrow-down"
              tint={theme.app.statusBlueFg}
              tintBg={theme.app.statusBlueBg}
              label="AI Inbox"
              value={String(inbox.data?.length ?? 0)}
              sub="pending review"
              onPress={() => router.push('/(tabs)/more')}
            />
          </View>

          <Text style={[styles.sectionTitle, { color: theme.app.foreground }]}>Recent transactions</Text>
          <Card style={{ backgroundColor: theme.app.surface }}>
            {recentTx.data?.transactions.length === 0 ? (
              <Card.Content><Text style={{ color: theme.app.mutedForeground }}>Nothing yet.</Text></Card.Content>
            ) : (
              recentTx.data?.transactions.map((tx, i) => (
                <View key={`${tx.type}:${tx.id}`}>
                  <Card.Content style={styles.txRow}>
                    <Avatar.Icon
                      size={36}
                      icon={isInflowType(tx.type) ? 'arrow-down' : 'arrow-up'}
                      style={{ backgroundColor: isInflowType(tx.type) ? theme.app.statusGreenBg : theme.app.statusGrayBg }}
                      color={isInflowType(tx.type) ? theme.app.statusGreenFg : theme.app.statusGrayFg}
                    />
                    <View style={{ flex: 1, marginLeft: spacing.sm }}>
                      <Text style={{ color: theme.app.foreground, fontWeight: '600' }} numberOfLines={1}>
                        {tx.contact_name ?? TX_TYPE_LABELS[tx.type] ?? tx.type}
                      </Text>
                      <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>
                        {TX_TYPE_LABELS[tx.type] ?? tx.type} · {fmtShortDate(tx.date)}
                      </Text>
                    </View>
                    <Text style={{ color: theme.app.foreground, fontWeight: '600' }}>${fmtMoney(tx.total_amount)}</Text>
                  </Card.Content>
                  {i < (recentTx.data?.transactions.length ?? 0) - 1 && <View style={[styles.divider, { backgroundColor: theme.app.border }]} />}
                </View>
              ))
            )}
          </Card>
        </>
      )}
    </ScrollView>
  );
}

function SummaryCard({
  theme, icon, tint, tintBg, label, value, sub, onPress,
}: {
  theme: AppTheme; icon: string; tint: string; tintBg: string; label: string; value: string; sub: string; onPress: () => void;
}) {
  return (
    <Card style={[styles.summaryCard, { backgroundColor: theme.app.surface }]} onPress={onPress}>
      <Card.Content>
        <Avatar.Icon size={32} icon={icon} style={{ backgroundColor: tintBg }} color={tint} />
        <Text style={{ fontSize: typeScale.h1, fontWeight: '700', color: theme.app.foreground, marginTop: spacing.sm }}>{value}</Text>
        <Text style={{ fontSize: typeScale.caption, color: theme.app.mutedForeground }}>{label}</Text>
        <Text style={{ fontSize: typeScale.caption, color: tint, marginTop: 2 }}>{sub}</Text>
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { marginBottom: spacing.lg },
  cardsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  summaryCard: { flex: 1 },
  sectionTitle: { fontSize: typeScale.h2, fontWeight: '700', marginBottom: spacing.sm },
  txRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: spacing.md + 36 + spacing.sm },
});
