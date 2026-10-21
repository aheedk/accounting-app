import { useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { AppCard } from '../components/ui/AppCard';
import { DateField } from '../components/DateField';
import { getTrialBalance, type TbRow } from '../services/api';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { fmtMoney } from '../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../theme';

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function TrialBalanceScreen() {
  const theme = useTheme<AppTheme>();
  const { activeBusinessId } = useAuth();
  const [asOf, setAsOf] = useState(todayIso());

  const query = useQuery({
    queryKey: ['trial-balance', activeBusinessId, asOf],
    queryFn: () => getTrialBalance(activeBusinessId!, { as_of: asOf }),
    enabled: !!activeBusinessId,
  });

  const inBalance = query.data ? query.data.totals.total_debit === query.data.totals.total_credit : true;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Trial Balance" />

      <View style={styles.dateRow}>
        <DateField label="As of" value={asOf} onChange={setAsOf} />
      </View>

      {query.isLoading ? (
        <LoadingIndicator />
      ) : query.error || !query.data ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <AppCard>
            <View style={[styles.row, styles.headerRow, { borderBottomColor: theme.app.border }]}>
              <Text style={[styles.acctCell, styles.headCell, { color: theme.app.mutedForeground }]}>Account</Text>
              <Text style={[styles.amtCell, styles.headCell, { color: theme.app.mutedForeground }]}>Debit</Text>
              <Text style={[styles.amtCell, styles.headCell, { color: theme.app.mutedForeground }]}>Credit</Text>
            </View>
            {query.data.rows.map((row, i) => (
              <RowItem key={row.account_id} row={row} theme={theme} last={i === query.data!.rows.length - 1} />
            ))}
            <View style={[styles.row, styles.totalRow, { borderTopColor: theme.app.border }]}>
              <Text style={[styles.acctCell, { color: theme.app.foreground, fontFamily: fontFamily.bold }]}>Total</Text>
              <Text style={[styles.amtCell, { color: theme.app.foreground, fontFamily: fontFamily.bold }]}>${fmtMoney(query.data.totals.total_debit)}</Text>
              <Text style={[styles.amtCell, { color: theme.app.foreground, fontFamily: fontFamily.bold }]}>${fmtMoney(query.data.totals.total_credit)}</Text>
            </View>
          </AppCard>

          <Text style={{
            color: inBalance ? theme.app.statusGreenFg : theme.app.statusRedFg,
            fontFamily: fontFamily.medium, fontSize: typeScale.caption, marginTop: spacing.sm, textAlign: 'center',
          }}>
            {inBalance ? 'Debits equal credits' : 'Debits and credits do not match'}
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

function RowItem({ row, theme, last }: { row: TbRow; theme: AppTheme; last: boolean }) {
  return (
    <View style={[styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.app.border }]}>
      <View style={styles.acctCell}>
        <Text style={{ color: theme.app.foreground }} numberOfLines={1}>{row.code} — {row.name}</Text>
        <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption, textTransform: 'capitalize' }}>{row.account_type}</Text>
      </View>
      <Text style={[styles.amtCell, { color: theme.app.foreground, fontFamily: fontFamily.medium }]}>
        {parseFloat(row.total_debit) !== 0 ? `$${fmtMoney(row.total_debit)}` : ''}
      </Text>
      <Text style={[styles.amtCell, { color: theme.app.foreground, fontFamily: fontFamily.medium }]}>
        {parseFloat(row.total_credit) !== 0 ? `$${fmtMoney(row.total_credit)}` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  dateRow: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  headerRow: { borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: spacing.xs },
  headCell: { fontSize: typeScale.caption, fontFamily: fontFamily.semibold, textTransform: 'uppercase' },
  totalRow: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 2 },
  acctCell: { flex: 1 },
  amtCell: { width: 90, textAlign: 'right' },
});
