import { useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, Pressable, Alert } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { hasMinRole, type Role } from '@accounting/shared';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { AppCard } from '../components/ui/AppCard';
import { AppButton } from '../components/ui/AppButton';
import { AppTextInput } from '../components/ui/AppTextInput';
import { PickerField } from '../components/PickerField';
import { SearchablePicker } from '../components/SearchablePicker';
import { listCodingRules, updateCodingRule, deleteCodingRule, listChartOfAccounts, type CodingRule } from '../services/api';
import { pickErr } from '../services/apiClient';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { fmtShortDate } from '../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../theme';

/**
 * The "learned client rule" layer CLAUDE.md's auto-coding order starts
 * with — read-only + edit-where-it-posts + delete, no create form here
 * (the engine only ever learns a rule implicitly, e.g. Suspense's
 * "Remember for this payee" — confirmed no create endpoint exists at
 * all, same as web's own CodingRulesPage.tsx).
 */
export default function CodingRulesScreen() {
  const theme = useTheme<AppTheme>();
  const { activeBusinessId, businesses, user } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const effectiveRole = (businesses.find(b => b.id === activeBusinessId)?.role_override ?? user?.role ?? 'viewer') as Role;
  const canManage = hasMinRole(effectiveRole, 'accountant');

  const query = useQuery({
    queryKey: ['coding-rules', activeBusinessId],
    queryFn: () => listCodingRules(activeBusinessId!),
    enabled: !!activeBusinessId,
  });
  const coaQuery = useQuery({
    queryKey: ['coa', activeBusinessId],
    queryFn: () => listChartOfAccounts(activeBusinessId!),
    enabled: !!activeBusinessId && canManage, staleTime: 5 * 60_000,
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const items = query.data ?? [];
    return q ? items.filter(r => r.normalized_vendor.toLowerCase().includes(q)) : items;
  }, [query.data, search]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Coding Rules" />

      <View style={styles.filterBar}>
        <AppTextInput
          placeholder="Search by vendor"
          value={search}
          onChangeText={setSearch}
          left={<MaterialCommunityIcons name="magnify" size={18} color={theme.app.mutedForeground} />}
        />
      </View>

      {query.isLoading ? (
        <LoadingIndicator />
      ) : query.error ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {rows.length === 0 ? (
            <EmptyState icon="creation" message="No learned rules yet." />
          ) : (
            rows.map(rule => (
              <RuleRow
                key={rule.id}
                rule={rule}
                theme={theme}
                expanded={expandedId === rule.id}
                onToggle={() => setExpandedId(prev => (prev === rule.id ? null : rule.id))}
                canManage={canManage}
                accountOptions={coaQuery.data ?? []}
                businessId={activeBusinessId!}
                onDone={() => {
                  setExpandedId(null);
                  void queryClient.invalidateQueries({ queryKey: ['coding-rules'] });
                }}
              />
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

function RuleRow({
  rule, theme, expanded, onToggle, canManage, accountOptions, businessId, onDone,
}: {
  rule: CodingRule; theme: AppTheme; expanded: boolean; onToggle: () => void; canManage: boolean;
  accountOptions: Array<{ id: string; code: string; name: string }>; businessId: string; onDone: () => void;
}) {
  const [accountIds, setAccountIds] = useState<Array<string | null>>(() => rule.lines.map(l => l.account_id));
  const [pickerForLine, setPickerForLine] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function accountLabel(id: string | null) {
    const a = accountOptions.find(acc => acc.id === id);
    return a ? `${a.code} — ${a.name}` : null;
  }

  async function save() {
    if (accountIds.some(id => !id)) { setError('Pick an account for every line.'); return; }
    setError(null);
    setSaving(true);
    try {
      await updateCodingRule(businessId, rule.id, accountIds as string[]);
      onDone();
    } catch (e) {
      setError(pickErr(e));
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete() {
    Alert.alert('Delete this rule?', `The engine will stop auto-coding "${rule.normalized_vendor}" this way.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: () => {
          void (async () => {
            setDeleting(true);
            try {
              await deleteCodingRule(businessId, rule.id);
              onDone();
            } catch (e) {
              setError(pickErr(e));
            } finally {
              setDeleting(false);
            }
          })();
        },
      },
    ]);
  }

  return (
    <AppCard style={{ marginBottom: spacing.sm }}>
      <Pressable onPress={onToggle} style={styles.rowHeader}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold }} numberOfLines={1}>
            {rule.normalized_vendor}
          </Text>
          <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }} numberOfLines={1}>
            {rule.direction === 'debit' ? 'Money out' : 'Money in'} · {rule.bank_account_name ?? 'Any account'}
            {rule.last_applied_at ? ` · Last used ${fmtShortDate(rule.last_applied_at)}` : ''}
          </Text>
        </View>
        <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption, marginRight: spacing.xs }}>
          {rule.times_applied}×
        </Text>
        <MaterialCommunityIcons name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={theme.app.mutedForeground} />
      </Pressable>

      {expanded ? (
        <View style={styles.editBox}>
          {rule.lines.map((line, i) => (
            <View key={i}>
              <PickerField
                label={rule.lines.length > 1 ? `Posts to (line ${i + 1})` : 'Posts to'}
                value={accountLabel(accountIds[i] ?? null)}
                placeholder="Pick an account"
                onPress={() => canManage && setPickerForLine(i)}
              />
              <SearchablePicker
                visible={pickerForLine === i}
                onDismiss={() => setPickerForLine(null)}
                title="Pick an account"
                options={accountOptions.map(a => ({ id: a.id, label: `${a.code} — ${a.name}` }))}
                onSelect={(id) => setAccountIds(prev => prev.map((v, idx) => (idx === i ? id : v)))}
              />
            </View>
          ))}

          {error ? <Text style={{ color: theme.app.destructive, fontSize: typeScale.caption, marginBottom: spacing.sm }}>{error}</Text> : null}

          {canManage ? (
            <View style={styles.actionsRow}>
              <AppButton variant="destructive" onPress={confirmDelete} loading={deleting} style={{ flex: 1 }}>Delete</AppButton>
              <AppButton onPress={() => void save()} loading={saving} style={{ flex: 1 }}>Save</AppButton>
            </View>
          ) : (
            <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>
              Your role doesn't have permission to change coding rules.
            </Text>
          )}
        </View>
      ) : null}
    </AppCard>
  );
}

const styles = StyleSheet.create({
  filterBar: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm },
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  rowHeader: { flexDirection: 'row', alignItems: 'center', padding: spacing.md },
  editBox: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.xs },
  actionsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
});
