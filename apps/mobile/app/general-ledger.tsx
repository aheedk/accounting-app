import { useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Appbar, List, Chip, Menu, Button, useTheme } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../hooks/useAuth';
import { listChartOfAccounts, getGeneralLedger, type GeneralLedgerLine } from '../services/api';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { fmtMoney, fmtShortDate } from '../lib/money';
import { spacing, typeScale, type AppTheme } from '../theme';

type Preset = 'this_month' | 'last_3_months' | 'this_year';

function presetRange(preset: Preset): { period_start: string; period_end: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (preset === 'this_month') {
    return { period_start: iso(new Date(y, m, 1)), period_end: iso(new Date(y, m + 1, 0)) };
  }
  if (preset === 'last_3_months') {
    return { period_start: iso(new Date(y, m - 2, 1)), period_end: iso(new Date(y, m + 1, 0)) };
  }
  return { period_start: iso(new Date(y, 0, 1)), period_end: iso(new Date(y, 11, 31)) };
}

const PRESET_LABELS: Record<Preset, string> = {
  this_month: 'This month', last_3_months: 'Last 3 months', this_year: 'This year',
};

export default function GeneralLedgerScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { activeBusinessId } = useAuth();
  const [preset, setPreset] = useState<Preset>('this_month');
  const [accountId, setAccountId] = useState<string | undefined>(undefined);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const range = useMemo(() => presetRange(preset), [preset]);

  const accountsQuery = useQuery({
    queryKey: ['coa', activeBusinessId],
    queryFn: () => listChartOfAccounts(activeBusinessId!),
    enabled: !!activeBusinessId,
    staleTime: 5 * 60_000, // item 7: CoA barely changes day to day
  });

  const glQuery = useQuery({
    queryKey: ['general-ledger', activeBusinessId, range.period_start, range.period_end, accountId],
    queryFn: () => getGeneralLedger(activeBusinessId!, { ...range, ...(accountId ? { account_id: accountId } : {}) }),
    enabled: !!activeBusinessId,
  });

  const selectedAccount = accountsQuery.data?.find(a => a.id === accountId);

  function toggle(accountIdKey: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(accountIdKey)) next.delete(accountIdKey); else next.add(accountIdKey);
      return next;
    });
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Appbar.Header statusBarHeight={insets.top} style={{ backgroundColor: theme.app.surface }}>
        <Appbar.BackAction onPress={() => router.back()} color={theme.app.foreground} />
        <Appbar.Content title="General Ledger" titleStyle={{ color: theme.app.foreground }} />
      </Appbar.Header>

      <View style={styles.filterBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs }}>
          {(Object.keys(PRESET_LABELS) as Preset[]).map(p => (
            <Chip key={p} selected={preset === p} onPress={() => setPreset(p)} selectedColor={theme.app.primary}>
              {PRESET_LABELS[p]}
            </Chip>
          ))}
          <Menu
            visible={accountMenuOpen}
            onDismiss={() => setAccountMenuOpen(false)}
            anchor={
              <Chip icon="chevron-down" onPress={() => setAccountMenuOpen(true)} selectedColor={theme.app.primary}>
                {selectedAccount ? `${selectedAccount.code} — ${selectedAccount.name}` : 'All accounts'}
              </Chip>
            }
          >
            <Menu.Item title="All accounts" onPress={() => { setAccountId(undefined); setAccountMenuOpen(false); }} />
            {accountsQuery.data?.map(a => (
              <Menu.Item
                key={a.id}
                title={`${a.code} — ${a.name}`}
                onPress={() => { setAccountId(a.id); setAccountMenuOpen(false); }}
              />
            ))}
          </Menu>
        </ScrollView>
      </View>

      {glQuery.isLoading ? (
        <LoadingIndicator />
      ) : glQuery.error ? (
        <ErrorState onRetry={() => void glQuery.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}>
          {glQuery.data?.accounts.length === 0 ? (
            <View style={styles.empty}>
              <Text style={{ color: theme.app.mutedForeground }}>No activity in this period.</Text>
            </View>
          ) : (
            glQuery.data?.accounts.map(acct => (
              <List.Accordion
                key={acct.account_id}
                title={`${acct.account_code} — ${acct.account_name}`}
                description={`Ending balance $${fmtMoney(acct.ending_balance)}`}
                titleStyle={{ color: theme.app.foreground, fontWeight: '600' }}
                descriptionStyle={{ color: theme.app.mutedForeground }}
                expanded={expanded.has(acct.account_id)}
                onPress={() => toggle(acct.account_id)}
                style={{ backgroundColor: theme.app.surface }}
              >
                <View style={[styles.balanceRow, { borderColor: theme.app.border }]}>
                  <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>Beginning balance</Text>
                  <Text style={{ color: theme.app.foreground, fontWeight: '600' }}>${fmtMoney(acct.beginning_balance)}</Text>
                </View>
                {acct.lines.map(line => <GlLineRow key={line.line_id} line={line} theme={theme} />)}
                <View style={[styles.balanceRow, { borderColor: theme.app.border, borderBottomWidth: 0 }]}>
                  <Text style={{ color: theme.app.foreground, fontWeight: '700' }}>Ending balance</Text>
                  <Text style={{ color: theme.app.foreground, fontWeight: '700' }}>${fmtMoney(acct.ending_balance)}</Text>
                </View>
              </List.Accordion>
            ))
          )}

          {glQuery.data && glQuery.data.accounts.length > 0 && (
            <View style={styles.reportTotal}>
              <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>
                Total debits ${fmtMoney(glQuery.data.totals.total_debit)} · Total credits ${fmtMoney(glQuery.data.totals.total_credit)}
              </Text>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

// Read-only, same as the transaction list/dashboard rows — tapping a line
// would ideally jump to its source document, but GL lines expose a WEB route
// (transaction_path) not a mobile one, and don't carry a type tag our
// /transaction/[id] screen could use either. Left as a view-only row.
function GlLineRow({ line, theme }: { line: GeneralLedgerLine; theme: AppTheme }) {
  const voided = line.status === 'voided';
  const amount = parseFloat(line.amount);
  return (
    <View style={[styles.lineRow, { borderColor: theme.app.border, opacity: voided ? 0.5 : 1 }]}>
      <View style={styles.lineTop}>
        <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>{fmtShortDate(line.entry_date)}</Text>
        <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>{line.transaction_label}{line.num ? ` #${line.num}` : ''}</Text>
      </View>
      <Text style={{ color: theme.app.foreground, fontWeight: '600' }} numberOfLines={1}>
        {line.name ?? line.memo ?? '—'}
      </Text>
      {line.memo && line.name ? (
        <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }} numberOfLines={1}>{line.memo}</Text>
      ) : null}
      {voided && <Chip compact style={{ alignSelf: 'flex-start', marginTop: 2, backgroundColor: theme.app.statusRedBg }} textStyle={{ color: theme.app.statusRedFg, fontSize: 10 }}>Voided</Chip>}
      <View style={styles.lineBottom}>
        <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>
          {line.split_account ?? '–Split–'}{line.is_reconciled ? ' · Reconciled' : ''}
        </Text>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: amount >= 0 ? theme.app.statusGreenFg : theme.app.statusRedFg, fontWeight: '700' }}>
            {amount >= 0 ? '' : '-'}${fmtMoney(Math.abs(amount))}
          </Text>
          <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>Bal ${fmtMoney(line.running_balance)}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  filterBar: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  empty: { alignItems: 'center', paddingTop: spacing.xxl },
  balanceRow: {
    flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  lineRow: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  lineTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  lineBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: spacing.xs },
  reportTotal: { padding: spacing.md, alignItems: 'center' },
});
