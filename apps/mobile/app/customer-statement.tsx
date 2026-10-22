import { useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { AppCard } from '../components/ui/AppCard';
import { PickerField } from '../components/PickerField';
import { SearchablePicker } from '../components/SearchablePicker';
import { DateField } from '../components/DateField';
import { listCustomers, getCustomerStatement, type StatementLine } from '../services/api';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { fiscalYearRange } from '../lib/transactionFilters';
import { fmtMoney, fmtShortDate } from '../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../theme';

const todayIso = () => new Date().toISOString().slice(0, 10);
const TYPE_LABEL: Record<StatementLine['type'], string> = { invoice: 'Invoice', payment: 'Payment', credit_memo: 'Credit Memo' };

/** A customer's statement — what they were billed, paid, and owe at each
 * step. View-only on mobile (web's export/print aren't built here). */
export default function CustomerStatementScreen() {
  const theme = useTheme<AppTheme>();
  const { businesses, activeBusinessId } = useAuth();
  const fiscalStartMonth = businesses.find(b => b.id === activeBusinessId)?.fiscal_year_start_month ?? 1;
  const defaultRange = fiscalYearRange(todayIso(), fiscalStartMonth);

  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [periodStart, setPeriodStart] = useState(defaultRange.start);
  const [periodEnd, setPeriodEnd] = useState(todayIso());

  const customersQuery = useQuery({
    queryKey: ['customers', activeBusinessId],
    queryFn: () => listCustomers(activeBusinessId!),
    enabled: !!activeBusinessId, staleTime: 5 * 60_000,
  });
  const statementQuery = useQuery({
    queryKey: ['customer-statement', activeBusinessId, customerId, periodStart, periodEnd],
    queryFn: () => getCustomerStatement(activeBusinessId!, { customer_id: customerId!, period_start: periodStart, period_end: periodEnd }),
    enabled: !!activeBusinessId && !!customerId,
  });

  const customer = customersQuery.data?.find(c => c.id === customerId);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Customer Statement" />

      <View style={styles.filterBar}>
        <PickerField label="Customer" value={customer?.name ?? null} onPress={() => setCustomerPickerOpen(true)} />
        <SearchablePicker
          visible={customerPickerOpen}
          onDismiss={() => setCustomerPickerOpen(false)}
          title="Pick a customer"
          options={(customersQuery.data ?? []).map(c => ({ id: c.id, label: c.name }))}
          onSelect={setCustomerId}
        />
        <View style={styles.dateRow}>
          <View style={{ flex: 1 }}>
            <DateField label="From" value={periodStart} onChange={setPeriodStart} />
          </View>
          <View style={{ flex: 1 }}>
            <DateField label="To" value={periodEnd} onChange={setPeriodEnd} />
          </View>
        </View>
      </View>

      {!customerId ? (
        <EmptyState icon="account-outline" message="Pick a customer to see their statement." />
      ) : statementQuery.isLoading ? (
        <LoadingIndicator />
      ) : statementQuery.error || !statementQuery.data ? (
        <ErrorState onRetry={() => void statementQuery.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <AppCard>
            <View style={[styles.row, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.app.border }]}>
              <Text style={{ color: theme.app.mutedForeground, fontFamily: fontFamily.medium, flex: 1 }}>Balance forward</Text>
              <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold }}>${fmtMoney(statementQuery.data.opening_balance)}</Text>
            </View>
            {statementQuery.data.lines.map((line, i) => (
              <View
                key={i}
                style={[styles.row, i < statementQuery.data!.lines.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.app.border }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium }} numberOfLines={1}>
                    {TYPE_LABEL[line.type]}{line.number ? ` #${line.number}` : ''}
                  </Text>
                  <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>{fmtShortDate(line.date)}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold }}>
                    {parseFloat(line.charge) !== 0 ? `$${fmtMoney(line.charge)}` : parseFloat(line.credit) !== 0 ? `-$${fmtMoney(line.credit)}` : ''}
                  </Text>
                  <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>Bal ${fmtMoney(line.balance)}</Text>
                </View>
              </View>
            ))}
            <View style={[styles.row, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.app.border }]}>
              <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.bold, flex: 1 }}>
                Amount due as of {fmtShortDate(periodEnd)}
              </Text>
              <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.bold, fontSize: typeScale.h3 }}>
                ${fmtMoney(statementQuery.data.closing_balance)}
              </Text>
            </View>
          </AppCard>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  filterBar: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  dateRow: { flexDirection: 'row', gap: spacing.sm },
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
