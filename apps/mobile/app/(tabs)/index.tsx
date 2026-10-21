import { useMemo } from 'react';
import { View, StyleSheet, RefreshControl, ScrollView, Pressable } from 'react-native';
import { Text, Avatar, useTheme } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useAuth } from '../../hooks/useAuth';
import { AppHeader } from '../../components/AppHeader';
import { AppCard } from '../../components/ui/AppCard';
import { listTransactions, listInvoices, listEmailImports } from '../../services/api';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { ErrorState } from '../../components/ErrorState';
import { EmptyState } from '../../components/EmptyState';
import { CameraCaptureButton } from '../../components/CameraCaptureButton';
import { fmtMoney, fmtShortDate } from '../../lib/money';
import { isInflowType } from '../../lib/transactions';
import { spacing, typeScale, fontFamily, type AppTheme } from '../../theme';

const TX_TYPE_LABELS: Record<string, string> = {
  deposit: 'Deposit', expense: 'Expense', check: 'Check', journal: 'Journal Entry',
  bill: 'Bill', payment: 'Payment', credit_memo: 'Credit Memo',
  invoice: 'Invoice', bill_payment: 'Bill Payment', vendor_credit: 'Vendor Credit',
};

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function DashboardScreen() {
  const theme = useTheme<AppTheme>();
  const { activeBusinessId } = useAuth();

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
  // Was pointed at the unrelated CSV-reconciliation inbox endpoint
  // (/integration-inbox) — fixed to the real AI Document Inbox backend
  // (email-imports.ts) while building the inbox review screen (item 4).
  const inbox = useQuery({
    queryKey: ['email-imports', activeBusinessId],
    queryFn: () => listEmailImports(activeBusinessId!),
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
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <AppHeader title="Dashboard" />
        <View style={styles.centered}>
          <Text>Pick a business to get started.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Dashboard" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={!loading && refreshing} onRefresh={refresh} tintColor={theme.app.primary} />}
      >
        <Pressable style={[styles.scanRow, { borderColor: theme.app.border, backgroundColor: theme.app.surface }]}>
          <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium, fontSize: typeScale.body }}>Scan a receipt or statement</Text>
          <CameraCaptureButton />
        </Pressable>

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
                onPress={() => router.push('/invoices')}
              />
              <SummaryCard
                theme={theme}
                icon="inbox-arrow-down"
                tint={theme.app.statusBlueFg}
                tintBg={theme.app.statusBlueBg}
                label="AI Inbox"
                value={String(inbox.data?.length ?? 0)}
                sub="pending review"
                onPress={() => router.push('/inbox')}
              />
            </View>

            <Text style={[styles.sectionTitle, { color: theme.app.foreground }]}>Recent transactions</Text>
            <AppCard>
              {recentTx.data?.transactions.length === 0 ? (
                <EmptyState icon="receipt" message="No transactions yet." compact />
              ) : (
                recentTx.data?.transactions.map((tx, i) => (
                  <View key={`${tx.type}:${tx.id}`}>
                    <Pressable
                      style={({ pressed }) => [styles.txRow, { paddingHorizontal: spacing.md, opacity: pressed ? 0.6 : 1 }]}
                      onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: tx.id, type: tx.type } })}
                    >
                      <Avatar.Icon
                        size={36}
                        icon={isInflowType(tx.type) ? 'arrow-down' : 'arrow-up'}
                        style={{ backgroundColor: isInflowType(tx.type) ? theme.app.statusGreenBg : theme.app.statusGrayBg }}
                        color={isInflowType(tx.type) ? theme.app.statusGreenFg : theme.app.statusGrayFg}
                      />
                      <View style={{ flex: 1, marginLeft: spacing.sm }}>
                        <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold, fontSize: typeScale.body }} numberOfLines={1}>
                          {tx.contact_name ?? TX_TYPE_LABELS[tx.type] ?? tx.type}
                        </Text>
                        <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption, fontFamily: fontFamily.regular }}>
                          {TX_TYPE_LABELS[tx.type] ?? tx.type} · {fmtShortDate(tx.date)}
                        </Text>
                      </View>
                      <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold, fontSize: typeScale.body }}>${fmtMoney(tx.total_amount)}</Text>
                    </Pressable>
                    {i < (recentTx.data?.transactions.length ?? 0) - 1 && <View style={[styles.divider, { backgroundColor: theme.app.border }]} />}
                  </View>
                ))
              )}
            </AppCard>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function SummaryCard({
  theme, icon, tint, tintBg, label, value, sub, onPress,
}: {
  theme: AppTheme; icon: string; tint: string; tintBg: string; label: string; value: string; sub: string; onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={{ flex: 1 }}>
      <AppCard style={styles.summaryCard}>
        <Avatar.Icon size={32} icon={icon} style={{ backgroundColor: tintBg }} color={tint} />
        <Text style={{ fontSize: typeScale.h1, fontFamily: fontFamily.semibold, color: theme.app.foreground, marginTop: spacing.sm }}>{value}</Text>
        <Text style={{ fontSize: typeScale.caption, color: theme.app.mutedForeground, fontFamily: fontFamily.regular }}>{label}</Text>
        <Text style={{ fontSize: typeScale.caption, color: tint, marginTop: 2, fontFamily: fontFamily.medium }}>{sub}</Text>
      </AppCard>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scanRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderRadius: 6, paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
    marginBottom: spacing.md,
  },
  cardsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  summaryCard: { flex: 1, padding: spacing.md },
  sectionTitle: { fontSize: typeScale.h2, fontFamily: fontFamily.semibold, marginBottom: spacing.sm },
  txRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: spacing.md + 36 + spacing.sm },
});
