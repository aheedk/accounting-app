import { useState } from 'react';
import { View, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Text, Checkbox, useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { hasMinRole, type Role } from '@accounting/shared';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { AppCard } from '../components/ui/AppCard';
import { AppButton } from '../components/ui/AppButton';
import { PickerField } from '../components/PickerField';
import { SearchablePicker } from '../components/SearchablePicker';
import { listSuspenseItems, reclassifySuspenseItem, listChartOfAccounts, type SuspenseItem } from '../services/api';
import { pickErr } from '../services/apiClient';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { fmtMoney, fmtShortDate } from '../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../theme';

/**
 * What the AI coding engine couldn't place anywhere real — parked in the
 * client's Suspense account and blocking period close (see CLAUDE.md's AI
 * auto-coding rules). A flat list with inline recode per row (no separate
 * detail screen, same as web's SuspensePage.tsx — there's no GET detail
 * endpoint, only list + reclassify). No ConfidenceBadge here: these are
 * confidence-0 by definition, so there's nothing to show.
 */
export default function SuspenseScreen() {
  const theme = useTheme<AppTheme>();
  const { activeBusinessId, businesses, user } = useAuth();
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const effectiveRole = (businesses.find(b => b.id === activeBusinessId)?.role_override ?? user?.role ?? 'viewer') as Role;
  const canReclassify = hasMinRole(effectiveRole, 'accountant');

  const query = useQuery({
    queryKey: ['suspense', activeBusinessId],
    queryFn: () => listSuspenseItems(activeBusinessId!),
    enabled: !!activeBusinessId,
  });
  const coaQuery = useQuery({
    queryKey: ['coa', activeBusinessId],
    queryFn: () => listChartOfAccounts(activeBusinessId!),
    enabled: !!activeBusinessId && canReclassify, staleTime: 5 * 60_000,
  });

  const items = query.data?.items ?? [];
  const totalBalance = items.reduce((s, i) => s + (i.direction === 'out' ? parseFloat(i.amount) : -parseFloat(i.amount)), 0);
  const oldestDays = items.length ? Math.max(...items.map(i => i.age_days)) : 0;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Suspense" />

      {query.isLoading ? (
        <LoadingIndicator />
      ) : query.error ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {items.length > 0 ? (
            <AppCard style={{ marginBottom: spacing.md, padding: spacing.md }}>
              <View style={styles.statsRow}>
                <Stat theme={theme} label="Waiting" value={String(items.length)} />
                <Stat theme={theme} label="In Suspense" value={`$${fmtMoney(Math.abs(totalBalance))}`} />
                <Stat theme={theme} label="Oldest" value={`${oldestDays}d`} tint={oldestDays > 30 ? theme.app.statusRedFg : undefined} />
              </View>
            </AppCard>
          ) : null}

          {items.length === 0 ? (
            <EmptyState icon="check-circle-outline" message="Nothing in Suspense." />
          ) : (
            items.map(item => (
              <SuspenseRow
                key={item.journal_entry_id}
                item={item}
                theme={theme}
                expanded={expandedId === item.journal_entry_id}
                onToggle={() => setExpandedId(prev => (prev === item.journal_entry_id ? null : item.journal_entry_id))}
                canReclassify={canReclassify}
                accountOptions={coaQuery.data ?? []}
                businessId={activeBusinessId!}
                onDone={() => {
                  setExpandedId(null);
                  void queryClient.invalidateQueries({ queryKey: ['suspense'] });
                }}
              />
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

function Stat({ theme, label, value, tint }: { theme: AppTheme; label: string; value: string; tint?: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>{label}</Text>
      <Text style={{ color: tint ?? theme.app.foreground, fontFamily: fontFamily.bold, fontSize: typeScale.h3 }}>{value}</Text>
    </View>
  );
}

function SuspenseRow({
  item, theme, expanded, onToggle, canReclassify, accountOptions, businessId, onDone,
}: {
  item: SuspenseItem; theme: AppTheme; expanded: boolean; onToggle: () => void; canReclassify: boolean;
  accountOptions: Array<{ id: string; code: string; name: string }>; businessId: string; onDone: () => void;
}) {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const [remember, setRemember] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const account = accountOptions.find(a => a.id === accountId);

  async function submit() {
    if (!accountId) { setError('Pick the account this belongs in.'); return; }
    setError(null);
    setSaving(true);
    try {
      await reclassifySuspenseItem(businessId, item.journal_entry_id, { account_id: accountId, remember });
      onDone();
    } catch (e) {
      setError(pickErr(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppCard style={{ marginBottom: spacing.sm }}>
      <Pressable onPress={onToggle} style={styles.rowHeader}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold }} numberOfLines={1}>
            {item.payee ?? item.description ?? item.label}
          </Text>
          <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }} numberOfLines={1}>
            {fmtShortDate(item.entry_date)} · {item.label}{item.num ? ` #${item.num}` : ''}
            {item.bank_account_name ? ` · ${item.bank_account_name}` : ''}
            {item.age_days > 30 ? ` · ${item.age_days}d old` : ''}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: item.direction === 'in' ? theme.app.statusGreenFg : theme.app.foreground, fontFamily: fontFamily.semibold }}>
            {item.direction === 'in' ? '+' : '-'}${fmtMoney(item.amount)}
          </Text>
        </View>
        <MaterialCommunityIcons name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={theme.app.mutedForeground} style={{ marginLeft: spacing.xs }} />
      </Pressable>

      {expanded ? (
        canReclassify ? (
          <View style={styles.recodeBox}>
            <PickerField
              label="Move to"
              value={account ? `${account.code} — ${account.name}` : null}
              placeholder="Pick an account"
              onPress={() => setAccountPickerOpen(true)}
            />
            <SearchablePicker
              visible={accountPickerOpen}
              onDismiss={() => setAccountPickerOpen(false)}
              title="Pick an account"
              options={accountOptions.map(a => ({ id: a.id, label: `${a.code} — ${a.name}` }))}
              onSelect={setAccountId}
            />
            <Checkbox.Item
              label="Remember for this payee"
              status={remember ? 'checked' : 'unchecked'}
              onPress={() => setRemember(v => !v)}
              position="leading"
              style={{ paddingHorizontal: 0 }}
              labelStyle={{ color: theme.app.foreground, fontSize: typeScale.caption }}
              color={theme.app.primary}
            />
            {error ? <Text style={{ color: theme.app.destructive, fontSize: typeScale.caption, marginBottom: spacing.sm }}>{error}</Text> : null}
            <AppButton onPress={() => void submit()} loading={saving} disabled={!accountId}>Reclassify</AppButton>
          </View>
        ) : (
          <View style={styles.recodeBox}>
            <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>
              Your role doesn't have permission to reclassify Suspense items.
            </Text>
          </View>
        )
      ) : null}
    </AppCard>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  statsRow: { flexDirection: 'row', gap: spacing.md },
  rowHeader: { flexDirection: 'row', alignItems: 'center', padding: spacing.md },
  recodeBox: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.xs },
});
