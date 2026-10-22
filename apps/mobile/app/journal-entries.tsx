import { useMemo, useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { AppChip } from '../components/ui/AppChip';
import { StatusBadge, statusToBadge } from '../components/ui/StatusBadge';
import { listJournalEntries, type JournalEntryListItem } from '../services/api';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { fmtMoney, fmtShortDate } from '../lib/money';
import { spacing, typeScale, fontFamily, minTouchTarget, type AppTheme } from '../theme';

type StatusFilter = 'all' | 'draft' | 'posted' | 'voided';
const FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All' }, { value: 'posted', label: 'Posted' },
  { value: 'draft', label: 'Draft' }, { value: 'voided', label: 'Voided' },
];

/**
 * Web has no standalone journal-entries list page — only a 10-row "Recent
 * Journal Entries" popover (RecentJournalEntries.tsx) off the same GET
 * /journal-entries endpoint this screen uses. Adapted into a real screen
 * for mobile (status filter + a full list instead of a dropdown) rather
 * than inventing a different pattern, since the endpoint already supports
 * the status filter and a generous limit.
 */
export default function JournalEntriesScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { activeBusinessId } = useAuth();
  const [filter, setFilter] = useState<StatusFilter>('all');

  const query = useQuery({
    queryKey: ['journal-entries', activeBusinessId, filter],
    queryFn: () => listJournalEntries(activeBusinessId!, filter === 'all' ? {} : { status: filter }),
    enabled: !!activeBusinessId,
  });

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Journal Entries" />

      <View style={styles.filterBar}>
        {FILTERS.map(f => (
          <AppChip key={f.value} label={f.label} active={filter === f.value} onPress={() => setFilter(f.value)} style={{ marginRight: spacing.xs }} />
        ))}
      </View>

      {query.isLoading ? (
        <LoadingIndicator />
      ) : query.error ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <FlashList
          data={query.data ?? []}
          keyExtractor={e => e.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
          ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.app.border }} />}
          ListEmptyComponent={<EmptyState icon="book-open-page-variant-outline" message="No journal entries match." />}
          renderItem={({ item }: { item: JournalEntryListItem }) => <EntryRow entry={item} theme={theme} />}
        />
      )}
    </View>
  );
}

function EntryRow({ entry, theme }: { entry: JournalEntryListItem; theme: AppTheme }) {
  const total = useMemo(() => entry.lines.reduce((sum, l) => sum + parseFloat(l.debit || '0'), 0), [entry.lines]);
  return (
    <Pressable
      style={({ pressed }) => [styles.row, { minHeight: minTouchTarget + 16, opacity: pressed ? 0.6 : 1 }]}
      onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: entry.id, type: 'journal' } })}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold, fontSize: typeScale.body }} numberOfLines={1}>
          {entry.journal_number ? `JE #${entry.journal_number}` : 'Journal Entry'}
        </Text>
        <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }} numberOfLines={1}>
          {fmtShortDate(entry.entry_date)}{entry.memo ? ` · ${entry.memo}` : ''}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold, fontSize: typeScale.body }}>${fmtMoney(total)}</Text>
        <StatusBadge status={statusToBadge(entry.status)} label={entry.status} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  filterBar: { flexDirection: 'row', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
