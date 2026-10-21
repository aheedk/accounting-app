import { useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { AppCard } from '../components/ui/AppCard';
import { DateField } from '../components/DateField';
import { getStatementOfCashFlows, type CfLine } from '../services/api';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { fiscalYearRange } from '../lib/transactionFilters';
import { fmtMoney } from '../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../theme';

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function CashFlowScreen() {
  const theme = useTheme<AppTheme>();
  const { businesses, activeBusinessId } = useAuth();
  const fiscalStartMonth = businesses.find(b => b.id === activeBusinessId)?.fiscal_year_start_month ?? 1;
  const defaultRange = fiscalYearRange(todayIso(), fiscalStartMonth);
  const [periodStart, setPeriodStart] = useState(defaultRange.start);
  const [periodEnd, setPeriodEnd] = useState(todayIso());

  const query = useQuery({
    queryKey: ['cash-flow', activeBusinessId, periodStart, periodEnd],
    queryFn: () => getStatementOfCashFlows(activeBusinessId!, { period_start: periodStart, period_end: periodEnd }),
    enabled: !!activeBusinessId,
  });

  const netPositive = query.data ? parseFloat(query.data.net_change_in_cash) >= 0 : true;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Statement of Cash Flows" />

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
            <Summary theme={theme} label="Beginning cash" value={query.data.cash_beginning} />
            <Summary
              theme={theme} label="Net change" value={query.data.net_change_in_cash}
              tint={netPositive ? theme.app.statusGreenFg : theme.app.statusRedFg}
            />
            <Summary theme={theme} label="Ending cash" value={query.data.cash_ending} />
          </View>

          <SectionHeading theme={theme} text="Operating activities" />
          <AppCard>
            <LineRow label="Net Income" value={query.data.net_income} theme={theme} last={query.data.operating_adjustments.length === 0} />
            {query.data.operating_adjustments.map((line, i) => (
              <LineRow
                key={line.account_id} label={`${line.account_code} — ${line.account_name}`} value={line.amount}
                theme={theme} last={i === query.data!.operating_adjustments.length - 1}
              />
            ))}
            <TotalRow theme={theme} label="Net cash provided by operating activities" value={query.data.operating_total} border />
          </AppCard>

          <SectionHeading theme={theme} text="Investing activities" />
          <AppCard>
            {query.data.investing.length === 0 ? (
              <View style={{ padding: spacing.md }}>
                <Text style={{ color: theme.app.mutedForeground }}>No investing activity in this period.</Text>
              </View>
            ) : (
              query.data.investing.map((line, i) => (
                <LineRow
                  key={line.account_id} label={`${line.account_code} — ${line.account_name}`} value={line.amount}
                  theme={theme} last={i === query.data!.investing.length - 1}
                />
              ))
            )}
            <TotalRow theme={theme} label="Net cash provided by investing activities" value={query.data.investing_total} border />
          </AppCard>

          <SectionHeading theme={theme} text="Financing activities" />
          <AppCard>
            {query.data.financing.length === 0 ? (
              <View style={{ padding: spacing.md }}>
                <Text style={{ color: theme.app.mutedForeground }}>No financing activity in this period.</Text>
              </View>
            ) : (
              query.data.financing.map((line, i) => (
                <LineRow
                  key={line.account_id} label={`${line.account_code} — ${line.account_name}`} value={line.amount}
                  theme={theme} last={i === query.data!.financing.length - 1}
                />
              ))
            )}
            <TotalRow theme={theme} label="Net cash provided by financing activities" value={query.data.financing_total} border />
          </AppCard>

          <TotalRow
            theme={theme} label="Net cash increase for period" value={query.data.net_change_in_cash} emphasize big
            tint={netPositive ? theme.app.statusGreenFg : theme.app.statusRedFg}
          />
          <TotalRow theme={theme} label="Cash at beginning of period" value={query.data.cash_beginning} />
          <TotalRow theme={theme} label="Cash at end of period" value={query.data.cash_ending} emphasize big />
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

function LineRow({ label, value, theme, last }: { label: string; value: string; theme: AppTheme; last: boolean }) {
  return (
    <View style={[styles.lineRow, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.app.border }]}>
      <Text style={{ color: theme.app.foreground, flex: 1 }} numberOfLines={1}>{label}</Text>
      <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium }}>${fmtMoney(value)}</Text>
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
      <Text style={{ color: tint ?? theme.app.foreground, fontFamily: fontFamily.bold, fontSize: big ? typeScale.h3 : typeScale.body, flex: 1 }} numberOfLines={2}>{label}</Text>
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
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
