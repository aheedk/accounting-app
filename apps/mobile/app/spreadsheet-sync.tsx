import { useMemo, useState } from 'react';
import { View, ScrollView, StyleSheet, Alert } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { AppCard } from '../components/ui/AppCard';
import { AppButton } from '../components/ui/AppButton';
import { AppMenu, AppMenuItem } from '../components/ui/AppMenu';
import { AppChip } from '../components/ui/AppChip';
import { DateField } from '../components/DateField';
import {
  listChartOfAccounts, exportTrialBalanceCsv, exportJournalEntriesCsv, exportGeneralLedgerCsv,
} from '../services/api';
import { pickErr } from '../services/apiClient';
import { fiscalYearRange } from '../lib/transactionFilters';
import { spacing, typeScale, fontFamily, type AppTheme } from '../theme';

const todayIso = () => new Date().toISOString().slice(0, 10);

type ReportKind = 'trial_balance' | 'journal_entries' | 'general_ledger';
const REPORT_LABELS: Record<ReportKind, string> = {
  trial_balance: 'Trial Balance', journal_entries: 'Journal Entries', general_ledger: 'General Ledger',
};

// Not an actual sync — there's no persistent connection to Google Sheets or
// Excel Online (confirmed: no such integration exists anywhere in this
// codebase). This mirrors what web's SpreadsheetSyncPage.tsx actually does:
// export one of three reports as a CSV file and hand it off — a browser
// download there, the native share sheet here (save to Files, AirDrop,
// mail, or open directly in a spreadsheet app already installed).
export default function SpreadsheetSyncScreen() {
  const theme = useTheme<AppTheme>();
  const { activeBusinessId, businesses } = useAuth();
  const fiscalStartMonth = businesses.find(b => b.id === activeBusinessId)?.fiscal_year_start_month ?? 1;
  const defaultRange = useMemo(() => fiscalYearRange(todayIso(), fiscalStartMonth), [fiscalStartMonth]);

  const [kind, setKind] = useState<ReportKind>('trial_balance');
  const [asOf, setAsOf] = useState(todayIso());
  const [periodStart, setPeriodStart] = useState(defaultRange.start);
  const [periodEnd, setPeriodEnd] = useState(todayIso());
  const [accountId, setAccountId] = useState<string | undefined>(undefined);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const accountsQuery = useQuery({
    queryKey: ['coa', activeBusinessId],
    queryFn: () => listChartOfAccounts(activeBusinessId!),
    enabled: !!activeBusinessId && kind === 'general_ledger',
    staleTime: 5 * 60_000,
  });
  const selectedAccount = accountsQuery.data?.find(a => a.id === accountId);

  async function handleExport() {
    setExporting(true);
    try {
      const result = kind === 'trial_balance'
        ? await exportTrialBalanceCsv(activeBusinessId!, asOf)
        : kind === 'journal_entries'
          ? await exportJournalEntriesCsv(activeBusinessId!, periodStart, periodEnd)
          : await exportGeneralLedgerCsv(activeBusinessId!, periodStart, periodEnd, accountId);

      const file = new File(Paths.cache, result.filename);
      if (file.exists) file.delete();
      file.create();
      await file.write(result.content);

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', dialogTitle: result.filename });
      } else {
        Alert.alert('Exported', `Saved to ${result.filename}, but sharing isn't available on this device.`);
      }
    } catch (e) {
      Alert.alert("Couldn't export", pickErr(e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Spreadsheet Sync" />
      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}>
        <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption, marginBottom: spacing.lg }}>
          Export a report as a CSV file to save, email, or open in a spreadsheet app.
        </Text>

        <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium, fontSize: typeScale.label, marginBottom: spacing.sm }}>Report</Text>
        <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.lg }}>
          {(Object.keys(REPORT_LABELS) as ReportKind[]).map(k => (
            <AppChip key={k} label={REPORT_LABELS[k]} active={kind === k} onPress={() => setKind(k)} />
          ))}
        </View>

        <AppCard style={{ padding: spacing.md, gap: spacing.sm }}>
          {kind === 'trial_balance' ? (
            <DateField label="As of" value={asOf} onChange={setAsOf} />
          ) : (
            <View style={styles.dateRow}>
              <View style={{ flex: 1 }}>
                <DateField label={kind === 'journal_entries' ? 'From' : 'Period start'} value={periodStart} onChange={setPeriodStart} />
              </View>
              <View style={{ flex: 1 }}>
                <DateField label={kind === 'journal_entries' ? 'To' : 'Period end'} value={periodEnd} onChange={setPeriodEnd} />
              </View>
            </View>
          )}

          {kind === 'general_ledger' ? (
            <AppMenu
              visible={accountMenuOpen}
              onDismiss={() => setAccountMenuOpen(false)}
              anchor={
                <AppChip
                  icon="chevron-down"
                  label={selectedAccount ? `${selectedAccount.code} — ${selectedAccount.name}` : 'All accounts'}
                  onPress={() => setAccountMenuOpen(true)}
                />
              }
            >
              <AppMenuItem title="All accounts" onPress={() => { setAccountId(undefined); setAccountMenuOpen(false); }} />
              {accountsQuery.data?.map(a => (
                <AppMenuItem key={a.id} title={`${a.code} — ${a.name}`} onPress={() => { setAccountId(a.id); setAccountMenuOpen(false); }} />
              ))}
            </AppMenu>
          ) : null}
        </AppCard>

        <AppButton onPress={() => void handleExport()} loading={exporting} style={{ marginTop: spacing.lg }}>
          Export CSV
        </AppButton>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  dateRow: { flexDirection: 'row', gap: spacing.sm },
});
