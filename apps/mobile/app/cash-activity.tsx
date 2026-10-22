import { useState } from 'react';
import { View, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { AppCard } from '../components/ui/AppCard';
import { StatusBadge } from '../components/ui/StatusBadge';
import { AppMenu, AppMenuItem } from '../components/ui/AppMenu';
import { AppChip } from '../components/ui/AppChip';
import { DateField } from '../components/DateField';
import { listBankAccounts, getCashActivity, type CashActivityLine } from '../services/api';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { fiscalYearRange } from '../lib/transactionFilters';
import { fmtMoney, fmtShortDate } from '../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../theme';

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function CashActivityScreen() {
  const theme = useTheme<AppTheme>();
  const { businesses, activeBusinessId } = useAuth();
  const fiscalStartMonth = businesses.find(b => b.id === activeBusinessId)?.fiscal_year_start_month ?? 1;
  const defaultRange = fiscalYearRange(todayIso(), fiscalStartMonth);
  const [periodStart, setPeriodStart] = useState(defaultRange.start);
  const [periodEnd, setPeriodEnd] = useState(todayIso());
  const [cashAccountId, setCashAccountId] = useState<string | undefined>(undefined);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  const accountsQuery = useQuery({
    queryKey: ['bank-accounts', activeBusinessId],
    queryFn: () => listBankAccounts(activeBusinessId!),
    enabled: !!activeBusinessId,
  });

  const query = useQuery({
    queryKey: ['cash-activity', activeBusinessId, periodStart, periodEnd, cashAccountId],
    queryFn: () => getCashActivity(activeBusinessId!, { period_start: periodStart, period_end: periodEnd, ...(cashAccountId ? { cash_account_id: cashAccountId } : {}) }),
    enabled: !!activeBusinessId,
  });

  const selectedAccount = accountsQuery.data?.find(a => a.cash_account_id === cashAccountId);
  const netPositive = query.data ? parseFloat(query.data.net_change) >= 0 : true;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Cash Activity by Account" />

      <View style={styles.filterBar}>
        <AppMenu
          visible={accountMenuOpen}
          onDismiss={() => setAccountMenuOpen(false)}
          anchor={
            <AppChip
              icon="chevron-down"
              label={selectedAccount ? selectedAccount.name : (query.data ? query.data.cash_account_name : 'Select account')}
              onPress={() => setAccountMenuOpen(true)}
            />
          }
        >
          {accountsQuery.data?.map(a => (
            <AppMenuItem key={a.id} title={a.name} onPress={() => { setCashAccountId(a.cash_account_id); setAccountMenuOpen(false); }} />
          ))}
        </AppMenu>
      </View>

      <View style={styles.dateRow}>
        <View style={{ flex: 1 }}>
          <DateField label="Period start" value={periodStart} onChange={setPeriodStart} />
        </View>
        <View style={{ flex: 1 }}>
          <DateField label="Period end" value={periodEnd} onChange={setPeriodEnd} />
        </View>
      </View>

      {query.isLoading ? (
        <LoadingIndicator />
      ) : query.error || !query.data ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.summaryRow}>
            <Summary theme={theme} label="Beginning balance" value={query.data.beginning_balance} />
            <Summary
              theme={theme} label="Net change" value={query.data.net_change}
              tint={netPositive ? theme.app.statusGreenFg : theme.app.statusRedFg}
            />
            <Summary theme={theme} label="Ending balance" value={query.data.ending_balance} />
          </View>

          {query.data.lines.length === 0 ? (
            <EmptyState icon="bank-outline" message="No activity in this period." />
          ) : (
            <AppCard style={{ padding: 0 }}>
              {query.data.lines.map((line, i) => (
                <ActivityLineRow key={`${line.journal_entry_id}-${i}`} line={line} theme={theme} last={i === query.data!.lines.length - 1} />
              ))}
            </AppCard>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function Summary({ theme, label, value, tint }: { theme: AppTheme; label: string; value: string; tint?: string }) {
  return (
    <AppCard style={styles.summaryCard}>
      <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption, fontFamily: fontFamily.medium }}>{label}</Text>
      <Text style={{ color: tint ?? theme.app.foreground, fontSize: typeScale.h3, fontFamily: fontFamily.bold, marginTop: 2 }} numberOfLines={1}>
        ${fmtMoney(value)}
      </Text>
    </AppCard>
  );
}

function ActivityLineRow({ line, theme, last }: { line: CashActivityLine; theme: AppTheme; last: boolean }) {
  const voided = line.status === 'voided';
  const amount = parseFloat(line.net_amount);
  return (
    <Pressable
      style={({ pressed }) => [
        styles.lineRow,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.app.border },
        { opacity: pressed ? 0.6 : voided ? 0.5 : 1 },
      ]}
      onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: line.journal_entry_id, type: 'journal' } })}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>{fmtShortDate(line.entry_date)} · {line.source_type}</Text>
        {line.memo ? <Text style={{ color: theme.app.foreground }} numberOfLines={1}>{line.memo}</Text> : null}
        {voided && <View style={{ marginTop: 2 }}><StatusBadge status="red" label="Voided" /></View>}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ color: amount >= 0 ? theme.app.statusGreenFg : theme.app.statusRedFg, fontFamily: fontFamily.bold }}>
          {amount >= 0 ? '' : '-'}${fmtMoney(Math.abs(amount))}
        </Text>
        <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>Bal ${fmtMoney(line.running_balance)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  filterBar: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  dateRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  summaryRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  summaryCard: { flex: 1, padding: spacing.sm },
  lineRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm },
});
