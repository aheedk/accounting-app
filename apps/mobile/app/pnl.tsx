import { useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { AppCard } from '../components/ui/AppCard';
import { DateField } from '../components/DateField';
import { getPnl, type PnlLine } from '../services/api';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { fiscalYearRange } from '../lib/transactionFilters';
import { fmtMoney } from '../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../theme';

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function ProfitLossScreen() {
  const theme = useTheme<AppTheme>();
  const { businesses, activeBusinessId } = useAuth();
  const fiscalStartMonth = businesses.find(b => b.id === activeBusinessId)?.fiscal_year_start_month ?? 1;
  const defaultRange = fiscalYearRange(todayIso(), fiscalStartMonth);
  const [periodStart, setPeriodStart] = useState(defaultRange.start);
  const [periodEnd, setPeriodEnd] = useState(todayIso());

  const query = useQuery({
    queryKey: ['pnl', activeBusinessId, periodStart, periodEnd],
    queryFn: () => getPnl(activeBusinessId!, { period_start: periodStart, period_end: periodEnd }),
    enabled: !!activeBusinessId,
  });

  const netPositive = query.data ? parseFloat(query.data.net_income) >= 0 : true;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Profit & Loss" />

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
            <Summary theme={theme} label="Revenue" value={query.data.revenue_total} />
            <Summary theme={theme} label="Expenses" value={query.data.expense_total} tint={theme.app.statusRedFg} />
            <Summary
              theme={theme} label="Net income" value={query.data.net_income}
              tint={netPositive ? theme.app.statusGreenFg : theme.app.statusRedFg}
            />
          </View>

          <SectionHeading theme={theme} text="Income" />
          <AppCard>
            {query.data.revenue_lines.length === 0 ? (
              <View style={{ padding: spacing.md }}>
                <Text style={{ color: theme.app.mutedForeground }}>No income in this period.</Text>
              </View>
            ) : (
              query.data.revenue_lines.map((line, i) => (
                <LineRow key={line.account_id} line={line} theme={theme} last={i === query.data!.revenue_lines.length - 1} />
              ))
            )}
            <TotalRow theme={theme} label="Total Income" value={query.data.revenue_total} border />
          </AppCard>

          <TotalRow theme={theme} label="Gross Profit" value={query.data.gross_profit} emphasize />

          <SectionHeading theme={theme} text="Expenses" />
          <AppCard>
            {query.data.expense_lines.length === 0 ? (
              <View style={{ padding: spacing.md }}>
                <Text style={{ color: theme.app.mutedForeground }}>No expenses in this period.</Text>
              </View>
            ) : (
              query.data.expense_lines.map((line, i) => (
                <LineRow key={line.account_id} line={line} theme={theme} last={i === query.data!.expense_lines.length - 1} />
              ))
            )}
            <TotalRow theme={theme} label="Total Expenses" value={query.data.expense_total} border />
          </AppCard>

          <TotalRow theme={theme} label="Net Operating Income" value={query.data.operating_income} emphasize />
          {parseFloat(query.data.other_expenses_total) !== 0 ? (
            <TotalRow theme={theme} label="Other Expenses" value={query.data.other_expenses_total} />
          ) : null}
          <TotalRow
            theme={theme} label="Net Income" value={query.data.net_income} emphasize big
            tint={netPositive ? theme.app.statusGreenFg : theme.app.statusRedFg}
          />
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

function SectionHeading({ theme, text }: { theme: AppTheme; text: string }) {
  return <Text style={{ fontSize: typeScale.h3, fontFamily: fontFamily.semibold, color: theme.app.foreground, marginBottom: spacing.sm, marginTop: spacing.sm }}>{text}</Text>;
}

function LineRow({ line, theme, last }: { line: PnlLine; theme: AppTheme; last: boolean }) {
  return (
    <View style={[styles.lineRow, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.app.border }]}>
      <Text style={{ color: theme.app.foreground, flex: 1 }} numberOfLines={1}>{line.account_code} — {line.account_name}</Text>
      <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium }}>${fmtMoney(line.amount)}</Text>
    </View>
  );
}

function TotalRow({
  theme, label, value, border, emphasize, big, tint,
}: { theme: AppTheme; label: string; value: string; border?: boolean; emphasize?: boolean; big?: boolean; tint?: string }) {
  return (
    <View style={[
      styles.totalRow,
      border && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.app.border },
      emphasize && { marginVertical: spacing.sm },
    ]}>
      <Text style={{ color: tint ?? theme.app.foreground, fontFamily: fontFamily.bold, fontSize: big ? typeScale.h3 : typeScale.body }}>{label}</Text>
      <Text style={{ color: tint ?? theme.app.foreground, fontFamily: fontFamily.bold, fontSize: big ? typeScale.h3 : typeScale.body }}>${fmtMoney(value)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  dateRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  summaryRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  summaryCard: { flex: 1, padding: spacing.sm },
  lineRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
