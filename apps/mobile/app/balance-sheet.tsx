import { useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { AppCard } from '../components/ui/AppCard';
import { DateField } from '../components/DateField';
import { getBalanceSheet, type BsLine } from '../services/api';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { assetBlocks, liabilityBlocks, type Block } from '../lib/balanceSheetLayout';
import { fmtMoney } from '../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../theme';

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function BalanceSheetScreen() {
  const theme = useTheme<AppTheme>();
  const { activeBusinessId } = useAuth();
  const [asOf, setAsOf] = useState(todayIso());

  const query = useQuery({
    queryKey: ['balance-sheet', activeBusinessId, asOf],
    queryFn: () => getBalanceSheet(activeBusinessId!, { as_of: asOf }),
    enabled: !!activeBusinessId,
  });

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Balance Sheet" />

      <View style={styles.dateRow}>
        <DateField label="As of" value={asOf} onChange={setAsOf} />
      </View>

      {query.isLoading ? (
        <LoadingIndicator />
      ) : query.error || !query.data ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={[
            styles.balanceBanner,
            { backgroundColor: query.data.in_balance ? theme.app.statusGreenBg : theme.app.statusRedBg },
          ]}>
            <MaterialCommunityIcons
              name={query.data.in_balance ? 'check-circle-outline' : 'alert-circle-outline'}
              size={18}
              color={query.data.in_balance ? theme.app.statusGreenFg : theme.app.statusRedFg}
            />
            <Text style={{ color: query.data.in_balance ? theme.app.statusGreenFg : theme.app.statusRedFg, fontFamily: fontFamily.semibold, marginLeft: spacing.xs }}>
              {query.data.in_balance ? 'In balance' : 'Out of balance'}
            </Text>
          </View>

          <SectionHeading theme={theme} text="Assets" />
          {assetBlocks(query.data.asset_lines).map(block => (
            <BlockCard key={block.label} block={block} theme={theme} />
          ))}
          <TotalRow theme={theme} label="Total Assets" value={query.data.assets_total} big />

          <SectionHeading theme={theme} text="Liabilities" />
          {liabilityBlocks(query.data.liability_lines).map(block => (
            <BlockCard key={block.label} block={block} theme={theme} />
          ))}
          <TotalRow theme={theme} label="Total Liabilities" value={query.data.liabilities_total} />

          <SectionHeading theme={theme} text="Equity" />
          <AppCard>
            {query.data.equity_lines.map((line, i) => (
              <LineRow key={line.account_id || line.account_name} line={line} theme={theme} last={false} />
            ))}
            <View style={styles.lineRow}>
              <Text style={{ color: theme.app.mutedForeground, flex: 1, fontStyle: 'italic' }}>Net Income (YTD)</Text>
              <Text style={{ color: theme.app.mutedForeground, fontFamily: fontFamily.medium, fontStyle: 'italic' }}>
                ${fmtMoney(query.data.net_income_ytd)}
              </Text>
            </View>
          </AppCard>
          <TotalRow
            theme={theme} label="Total Equity"
            value={String(parseFloat(query.data.equity_total) + parseFloat(query.data.net_income_ytd))}
          />

          <TotalRow theme={theme} label="Total Liabilities and Equity" value={query.data.liabilities_equity_total} big emphasize />
        </ScrollView>
      )}
    </View>
  );
}

function SectionHeading({ theme, text }: { theme: AppTheme; text: string }) {
  return <Text style={{ fontSize: typeScale.h3, fontFamily: fontFamily.semibold, color: theme.app.foreground, marginBottom: spacing.sm, marginTop: spacing.sm }}>{text}</Text>;
}

function BlockCard({ block, theme }: { block: Block; theme: AppTheme }) {
  return (
    <AppCard style={{ marginBottom: spacing.sm }}>
      <View style={[styles.lineRow, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.app.border, paddingBottom: spacing.xs }]}>
        <Text style={{ color: theme.app.mutedForeground, fontFamily: fontFamily.semibold, fontSize: typeScale.caption, textTransform: 'uppercase' }}>{block.label}</Text>
      </View>
      {block.lines.map((line, i) => (
        <LineRow key={line.account_id} line={line} theme={theme} last={i === block.lines.length - 1} noBorder />
      ))}
      <View style={[styles.lineRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.app.border }]}>
        <Text style={{ color: theme.app.foreground, flex: 1, fontFamily: fontFamily.semibold }}>Total {block.label}</Text>
        <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold }}>${fmtMoney(block.subtotal)}</Text>
      </View>
    </AppCard>
  );
}

function LineRow({ line, theme, last, noBorder }: { line: BsLine; theme: AppTheme; last: boolean; noBorder?: boolean }) {
  return (
    <View style={[styles.lineRow, !last && !noBorder && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.app.border }]}>
      <Text style={{ color: theme.app.foreground, flex: 1 }} numberOfLines={1}>{line.account_code} — {line.account_name}</Text>
      <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium }}>${fmtMoney(line.amount)}</Text>
    </View>
  );
}

function TotalRow({
  theme, label, value, big, emphasize,
}: { theme: AppTheme; label: string; value: string; big?: boolean; emphasize?: boolean }) {
  return (
    <View style={[styles.totalRow, emphasize && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.app.border, paddingTop: spacing.sm, marginTop: spacing.xs }]}>
      <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.bold, fontSize: big ? typeScale.h3 : typeScale.body }}>{label}</Text>
      <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.bold, fontSize: big ? typeScale.h3 : typeScale.body }}>${fmtMoney(value)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  dateRow: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  balanceBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 6, paddingVertical: spacing.sm, marginBottom: spacing.md },
  lineRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
