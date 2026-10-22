import { useState } from 'react';
import { View, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { hasMinRole, type Role } from '@accounting/shared';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { AppCard } from '../components/ui/AppCard';
import { AppButton } from '../components/ui/AppButton';
import { AppTextInput } from '../components/ui/AppTextInput';
import { AppChip } from '../components/ui/AppChip';
import { AppMenu, AppMenuItem } from '../components/ui/AppMenu';
import { DateField } from '../components/DateField';
import {
  listChartOfAccounts, listCustomReports, createCustomReport, deleteCustomReport,
  runCustomReport, runSavedCustomReport,
  type CoaAccount, type CustomReport, type CustomReportDefinition, type CustomReportGroupBy,
  type CustomReportColumn, type CustomReportRow,
} from '../services/api';
import { pickErr } from '../services/apiClient';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { fiscalYearRange } from '../lib/transactionFilters';
import { fmtMoney } from '../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../theme';

const todayIso = () => new Date().toISOString().slice(0, 10);

const GROUP_BY_LABELS: Record<CustomReportGroupBy, string> = {
  account: 'Account', month: 'Month', cost_center: 'Cost center', customer: 'Customer', vendor: 'Vendor',
};
const COLUMN_LABELS: Record<CustomReportColumn, string> = { debit: 'Debit', credit: 'Credit', net: 'Net' };

function defaultDefinition(fiscalStartMonth: number): CustomReportDefinition {
  return {
    account_ids: [],
    date_range: { from: fiscalYearRange(todayIso(), fiscalStartMonth).start, to: todayIso() },
    group_by: 'account',
    columns: ['debit', 'credit', 'net'],
  };
}

export default function CustomReportsScreen() {
  const theme = useTheme<AppTheme>();
  const { activeBusinessId, businesses, user } = useAuth();
  const queryClient = useQueryClient();
  const fiscalStartMonth = businesses.find(b => b.id === activeBusinessId)?.fiscal_year_start_month ?? 1;
  const effectiveRole = (businesses.find(b => b.id === activeBusinessId)?.role_override ?? user?.role ?? 'viewer') as Role;
  const canDelete = hasMinRole(effectiveRole, 'accountant');

  const [mode, setMode] = useState<'list' | 'builder'>('list');
  const [name, setName] = useState('');
  const [definition, setDefinition] = useState<CustomReportDefinition>(() => defaultDefinition(fiscalStartMonth));
  const [rows, setRows] = useState<CustomReportRow[] | null>(null);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const [accountsOpen, setAccountsOpen] = useState(false);

  const reportsQuery = useQuery({
    queryKey: ['custom-reports', activeBusinessId],
    queryFn: () => listCustomReports(activeBusinessId!),
    enabled: !!activeBusinessId,
  });

  const accountsQuery = useQuery({
    queryKey: ['coa', activeBusinessId],
    queryFn: () => listChartOfAccounts(activeBusinessId!),
    enabled: !!activeBusinessId,
  });

  function startNewReport() {
    setName('');
    setDefinition(defaultDefinition(fiscalStartMonth));
    setRows(null);
    setMode('builder');
  }

  function toggleColumn(col: CustomReportColumn) {
    setDefinition(d => ({
      ...d,
      columns: d.columns.includes(col) ? d.columns.filter(c => c !== col) : [...d.columns, col],
    }));
  }

  function toggleAccount(id: string) {
    setDefinition(d => ({
      ...d,
      account_ids: d.account_ids.includes(id) ? d.account_ids.filter(a => a !== id) : [...d.account_ids, id],
    }));
  }

  async function handleRun() {
    if (definition.columns.length === 0) { Alert.alert('Pick at least one column.'); return; }
    setRunning(true);
    try {
      setRows(await runCustomReport(activeBusinessId!, definition));
    } catch (e) {
      Alert.alert("Couldn't run report", pickErr(e));
    } finally {
      setRunning(false);
    }
  }

  async function handleSave() {
    if (!name.trim()) { Alert.alert('Give the report a name.'); return; }
    if (definition.columns.length === 0) { Alert.alert('Pick at least one column.'); return; }
    setSaving(true);
    try {
      await createCustomReport(activeBusinessId!, name.trim(), definition);
      await queryClient.invalidateQueries({ queryKey: ['custom-reports'] });
      setMode('list');
    } catch (e) {
      Alert.alert("Couldn't save report", pickErr(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleRunSaved(report: CustomReport) {
    setRunning(true);
    setName(report.name);
    setDefinition(report.definition);
    setMode('builder');
    try {
      setRows(await runSavedCustomReport(activeBusinessId!, report.id));
    } catch (e) {
      Alert.alert("Couldn't run report", pickErr(e));
    } finally {
      setRunning(false);
    }
  }

  function handleDelete(report: CustomReport) {
    Alert.alert('Delete this report?', `"${report.name}" will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteCustomReport(activeBusinessId!, report.id);
              await queryClient.invalidateQueries({ queryKey: ['custom-reports'] });
            } catch (e) {
              Alert.alert('Could not delete', pickErr(e));
            }
          })();
        },
      },
    ]);
  }

  if (mode === 'builder') {
    const selectedAccountNames = definition.account_ids
      .map(id => accountsQuery.data?.find(a => a.id === id))
      .filter((a): a is CoaAccount => !!a);

    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <AppHeader title={name || 'New Report'} />
        <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}>
          <Pressable onPress={() => setMode('list')} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: spacing.md }}>
            <MaterialCommunityIcons name="chevron-left" size={18} color={theme.app.primary} />
            <Text style={{ color: theme.app.primary, fontFamily: fontFamily.medium }}>All reports</Text>
          </Pressable>

          <AppTextInput label="Report name" value={name} onChangeText={setName} placeholder="e.g. Q3 expenses by month" containerStyle={{ marginBottom: spacing.md }} />

          <View style={styles.dateRow}>
            <View style={{ flex: 1 }}>
              <DateField label="From" value={definition.date_range.from} onChange={v => setDefinition(d => ({ ...d, date_range: { ...d.date_range, from: v } }))} />
            </View>
            <View style={{ flex: 1 }}>
              <DateField label="To" value={definition.date_range.to} onChange={v => setDefinition(d => ({ ...d, date_range: { ...d.date_range, to: v } }))} />
            </View>
          </View>

          <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium, fontSize: typeScale.label, marginBottom: 4 }}>Group by</Text>
          <AppMenu
            visible={groupMenuOpen}
            onDismiss={() => setGroupMenuOpen(false)}
            anchor={<AppChip icon="chevron-down" label={GROUP_BY_LABELS[definition.group_by]} onPress={() => setGroupMenuOpen(true)} />}
          >
            {(Object.keys(GROUP_BY_LABELS) as CustomReportGroupBy[]).map(g => (
              <AppMenuItem key={g} title={GROUP_BY_LABELS[g]} onPress={() => { setDefinition(d => ({ ...d, group_by: g })); setGroupMenuOpen(false); }} />
            ))}
          </AppMenu>

          <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium, fontSize: typeScale.label, marginTop: spacing.md, marginBottom: 4 }}>Columns</Text>
          <View style={{ flexDirection: 'row', gap: spacing.xs }}>
            {(Object.keys(COLUMN_LABELS) as CustomReportColumn[]).map(c => (
              <AppChip key={c} label={COLUMN_LABELS[c]} active={definition.columns.includes(c)} onPress={() => toggleColumn(c)} />
            ))}
          </View>

          <Pressable onPress={() => setAccountsOpen(o => !o)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md, marginBottom: spacing.xs }}>
            <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium, fontSize: typeScale.label }}>
              Accounts ({definition.account_ids.length === 0 ? 'all' : definition.account_ids.length})
            </Text>
            <MaterialCommunityIcons name={accountsOpen ? 'chevron-up' : 'chevron-down'} size={18} color={theme.app.mutedForeground} />
          </Pressable>
          {!accountsOpen && selectedAccountNames.length > 0 ? (
            <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption, marginBottom: spacing.sm }} numberOfLines={2}>
              {selectedAccountNames.map(a => a.code).join(', ')}
            </Text>
          ) : null}
          {accountsOpen ? (
            <AppCard style={{ padding: 0, marginBottom: spacing.md, maxHeight: 280 }}>
              <ScrollView>
                {accountsQuery.data?.map((a, i) => (
                  <Pressable
                    key={a.id}
                    onPress={() => toggleAccount(a.id)}
                    style={[
                      styles.accountRow,
                      i !== (accountsQuery.data?.length ?? 0) - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.app.border },
                    ]}
                  >
                    <MaterialCommunityIcons
                      name={definition.account_ids.includes(a.id) ? 'checkbox-marked' : 'checkbox-blank-outline'}
                      size={18} color={definition.account_ids.includes(a.id) ? theme.app.primary : theme.app.mutedForeground}
                    />
                    <Text style={{ color: theme.app.foreground, flex: 1 }} numberOfLines={1}>{a.code} — {a.name}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </AppCard>
          ) : null}

          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
            <AppButton variant="outline" onPress={() => void handleRun()} loading={running} style={{ flex: 1 }}>Run</AppButton>
            <AppButton onPress={() => void handleSave()} loading={saving} style={{ flex: 1 }}>Save & Run</AppButton>
          </View>

          {rows !== null ? (
            <View style={{ marginTop: spacing.lg }}>
              {rows.length === 0 ? (
                <EmptyState icon="table-off" message="No activity matches this report." />
              ) : (
                <AppCard style={{ padding: 0 }}>
                  <View style={[styles.resultRow, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.app.border }]}>
                    <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption, fontFamily: fontFamily.semibold, flex: 1 }}>
                      {GROUP_BY_LABELS[definition.group_by]}
                    </Text>
                    {definition.columns.map(c => (
                      <Text key={c} style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption, fontFamily: fontFamily.semibold, width: 90, textAlign: 'right' }}>
                        {COLUMN_LABELS[c]}
                      </Text>
                    ))}
                  </View>
                  {rows.map((row, i) => (
                    <View key={row.group_key} style={[styles.resultRow, i !== rows.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.app.border }]}>
                      <Text style={{ color: theme.app.foreground, flex: 1 }} numberOfLines={1}>{row.group_key}</Text>
                      {definition.columns.map(c => (
                        <Text key={c} style={{ color: theme.app.foreground, fontFamily: fontFamily.medium, width: 90, textAlign: 'right' }}>${fmtMoney(row[c])}</Text>
                      ))}
                    </View>
                  ))}
                </AppCard>
              )}
            </View>
          ) : null}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Custom Reports" />
      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}>
        <AppButton onPress={startNewReport} style={{ marginBottom: spacing.md }}>New Report</AppButton>

        {reportsQuery.isLoading ? (
          <LoadingIndicator />
        ) : reportsQuery.error ? (
          <ErrorState onRetry={() => void reportsQuery.refetch()} />
        ) : !reportsQuery.data || reportsQuery.data.length === 0 ? (
          <EmptyState icon="file-chart-outline" message="No saved reports yet." />
        ) : (
          <AppCard style={{ padding: 0 }}>
            {reportsQuery.data.map((report, i) => (
              <Pressable
                key={report.id}
                onPress={() => void handleRunSaved(report)}
                style={[styles.listRow, i !== reportsQuery.data!.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.app.border }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium }} numberOfLines={1}>{report.name}</Text>
                  <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>
                    {GROUP_BY_LABELS[report.definition.group_by]} · {report.definition.date_range.from} – {report.definition.date_range.to}
                  </Text>
                </View>
                {canDelete ? (
                  <Pressable onPress={() => handleDelete(report)} hitSlop={8} style={{ marginLeft: spacing.sm }}>
                    <MaterialCommunityIcons name="trash-can-outline" size={18} color={theme.app.destructive} />
                  </Pressable>
                ) : null}
              </Pressable>
            ))}
          </AppCard>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  dateRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  resultRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm },
  listRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
