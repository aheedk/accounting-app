import { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, Pressable, Alert } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../hooks/useAuth';
import { AppHeader } from '../../components/AppHeader';
import { AppCard } from '../../components/ui/AppCard';
import { AppButton } from '../../components/ui/AppButton';
import { AppChip } from '../../components/ui/AppChip';
import {
  getWorksheet, saveReconciliationProgress, finishReconciliation,
  type WorksheetItem,
} from '../../services/api';
import { pickErr } from '../../services/apiClient';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { ErrorState } from '../../components/ErrorState';
import { EmptyState } from '../../components/EmptyState';
import { fmtMoney, fmtShortDate } from '../../lib/money';
import { spacing, typeScale, fontFamily, minTouchTarget, type AppTheme } from '../../theme';

type RowFilter = 'all' | 'deposits' | 'payments';
const itemKey = (i: WorksheetItem) => `${i.transaction_type}:${i.transaction_id}`;

/**
 * Clearing is kept local (an in-memory Map, same as web's worksheet) so
 * ticking a row feels instant and the running difference recomputes
 * without a network round trip per tap — Save sends the whole current
 * state in one PATCH, same contract web's own "Save for later" button
 * uses, and Finish saves once more right before calling finish (in case
 * the user never tapped Save), matching web's own finish flow exactly.
 */
export default function ReconciliationWorksheetScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { activeBusinessId } = useAuth();
  const queryClient = useQueryClient();

  const [cleared, setCleared] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<RowFilter>('all');
  const [saving, setSaving] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const query = useQuery({
    queryKey: ['reconciliation-worksheet', activeBusinessId, id],
    queryFn: () => getWorksheet(activeBusinessId!, id!),
    enabled: !!activeBusinessId && !!id,
  });

  useEffect(() => {
    if (!query.data) return;
    setCleared(prev => {
      if (Object.keys(prev).length > 0) return prev;
      const init: Record<string, boolean> = {};
      for (const item of query.data!.items) init[itemKey(item)] = item.is_cleared;
      return init;
    });
  }, [query.data]);

  const items = query.data?.items ?? [];
  const rows = useMemo(() => {
    if (filter === 'all') return items;
    return items.filter(i => (filter === 'deposits' ? parseFloat(i.amount) >= 0 : parseFloat(i.amount) < 0));
  }, [items, filter]);

  const summary = useMemo(() => {
    if (!query.data) return null;
    const beginning = parseFloat(query.data.summary.statement_beginning_balance);
    const ending = parseFloat(query.data.summary.statement_ending_balance);
    let clearedBalance = beginning;
    let clearedCount = 0;
    for (const item of items) {
      if (cleared[itemKey(item)]) {
        clearedBalance += parseFloat(item.amount);
        clearedCount++;
      }
    }
    return {
      beginning, ending, clearedBalance,
      difference: ending - clearedBalance,
      clearedCount, totalCount: items.length,
    };
  }, [query.data, items, cleared]);

  function toggle(item: WorksheetItem) {
    setCleared(prev => ({ ...prev, [itemKey(item)]: !prev[itemKey(item)] }));
    setDirty(true);
  }

  async function saveProgress() {
    if (!query.data) return false;
    setServerError(null);
    setSaving(true);
    try {
      await saveReconciliationProgress(
        activeBusinessId!, id!,
        items.map(i => ({ transaction_type: i.transaction_type, transaction_id: i.transaction_id, is_cleared: !!cleared[itemKey(i)] })),
      );
      setDirty(false);
      return true;
    } catch (e) {
      setServerError(pickErr(e));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function doFinish(acceptDifference: boolean) {
    setFinishing(true);
    setServerError(null);
    try {
      const saved = await saveProgress();
      if (!saved) return;
      await finishReconciliation(activeBusinessId!, id!, acceptDifference);
      await queryClient.invalidateQueries({ queryKey: ['reconciliation-status'] });
      await queryClient.invalidateQueries({ queryKey: ['reconciliation-history'] });
      Alert.alert('Reconciliation complete', 'This account is reconciled through the statement date.');
      router.replace('/reconcile');
    } catch (e) {
      setServerError(pickErr(e));
    } finally {
      setFinishing(false);
    }
  }

  function handleFinish() {
    if (!summary) return;
    if (Math.abs(summary.difference) > 0.005) {
      Alert.alert(
        `$${fmtMoney(Math.abs(summary.difference))} difference`,
        'The cleared balance doesn\'t match the statement. Finishing anyway posts an adjusting entry for the difference.',
        [
          { text: 'Keep reviewing', style: 'cancel' },
          { text: 'Finish anyway', style: 'destructive', onPress: () => void doFinish(true) },
        ],
      );
      return;
    }
    void doFinish(false);
  }

  if (query.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <AppHeader title="Reconcile" leading="back" />
        <LoadingIndicator />
      </View>
    );
  }
  if (query.error || !query.data || !summary) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <AppHeader title="Reconcile" leading="back" />
        <ErrorState onRetry={() => void query.refetch()} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title={`${query.data.account.code} — ${query.data.account.name}`} leading="back" />

      <AppCard style={styles.summaryCard}>
        <View style={styles.summaryGrid}>
          <SummaryStat theme={theme} label="Statement" value={summary.ending} />
          <SummaryStat theme={theme} label="Cleared" value={summary.clearedBalance} />
          <SummaryStat
            theme={theme} label="Difference" value={summary.difference}
            tint={Math.abs(summary.difference) <= 0.005 ? theme.app.statusGreenFg : theme.app.statusRedFg}
          />
        </View>
        <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption, marginTop: spacing.xs }}>
          {summary.clearedCount} of {summary.totalCount} checked
        </Text>
      </AppCard>

      <View style={styles.filterBar}>
        <AppChip label="All" active={filter === 'all'} onPress={() => setFilter('all')} style={{ marginRight: spacing.xs }} />
        <AppChip label="Deposits" active={filter === 'deposits'} onPress={() => setFilter('deposits')} style={{ marginRight: spacing.xs }} />
        <AppChip label="Payments" active={filter === 'payments'} onPress={() => setFilter('payments')} />
      </View>

      {rows.length === 0 ? (
        <EmptyState icon="bank-check" message="Nothing to reconcile here." />
      ) : (
        <FlashList
          data={rows}
          keyExtractor={itemKey}
          contentContainerStyle={{ paddingBottom: spacing.xxl }}
          ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.app.border }} />}
          renderItem={({ item }: { item: WorksheetItem }) => (
            <ItemRow item={item} checked={!!cleared[itemKey(item)]} onToggle={() => toggle(item)} theme={theme} />
          )}
        />
      )}

      {serverError ? (
        <Text style={{ color: theme.app.destructive, paddingHorizontal: spacing.md, paddingTop: spacing.xs }}>{serverError}</Text>
      ) : null}

      <View style={[styles.footer, { borderColor: theme.app.border, backgroundColor: theme.app.surface, paddingBottom: insets.bottom + spacing.sm }]}>
        <AppButton variant="outline" onPress={() => void saveProgress()} loading={saving} disabled={!dirty}>
          Save
        </AppButton>
        <AppButton onPress={handleFinish} loading={finishing} style={{ flex: 1 }}>
          Finish
        </AppButton>
      </View>
    </View>
  );
}

function SummaryStat({ theme, label, value, tint }: { theme: AppTheme; label: string; value: number; tint?: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>{label}</Text>
      <Text style={{ color: tint ?? theme.app.foreground, fontFamily: fontFamily.bold, fontSize: typeScale.h3 }} numberOfLines={1}>
        ${fmtMoney(Math.abs(value))}
      </Text>
    </View>
  );
}

function ItemRow({ item, checked, onToggle, theme }: { item: WorksheetItem; checked: boolean; onToggle: () => void; theme: AppTheme }) {
  const amount = parseFloat(item.amount);
  return (
    <Pressable
      style={({ pressed }) => [styles.row, { minHeight: minTouchTarget + 10, opacity: pressed ? 0.6 : 1 }]}
      onPress={onToggle}
    >
      <MaterialCommunityIcons
        name={checked ? 'checkbox-marked' : 'checkbox-blank-outline'}
        size={22}
        color={checked ? theme.app.primary : theme.app.mutedForeground}
      />
      <View style={{ flex: 1, marginLeft: spacing.sm }}>
        <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium }} numberOfLines={1}>
          {item.name ?? item.description ?? item.type_label}
        </Text>
        <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }} numberOfLines={1}>
          {fmtShortDate(item.transaction_date)} · {item.type_label}{item.ref_no ? ` #${item.ref_no}` : ''}
          {item.auto_matched ? ' · Auto-matched' : ''}
        </Text>
      </View>
      <Text style={{ color: amount >= 0 ? theme.app.statusGreenFg : theme.app.foreground, fontFamily: fontFamily.semibold }}>
        {amount >= 0 ? '+' : '-'}${fmtMoney(Math.abs(amount))}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  summaryCard: { marginHorizontal: spacing.md, marginTop: spacing.sm, padding: spacing.md },
  summaryGrid: { flexDirection: 'row', gap: spacing.md },
  filterBar: { flexDirection: 'row', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  footer: {
    flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
