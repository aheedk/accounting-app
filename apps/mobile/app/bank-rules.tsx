import { View, StyleSheet, Alert, Pressable } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { hasMinRole, type Role } from '@accounting/shared';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { AppCard } from '../components/ui/AppCard';
import { StatusBadge } from '../components/ui/StatusBadge';
import { listBankRules, deleteBankRule, type BankRule } from '../services/api';
import { pickErr } from '../services/apiClient';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { fmtMoney } from '../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../theme';

const SIGN_LABEL = { any: 'Any amount', inflow_only: 'Money in only', outflow_only: 'Money out only' } as const;

/**
 * Manually-defined keyword/amount-match rules on the bank feed — distinct
 * from AI Coding Rules (coding-rules.tsx), which are the engine's own
 * learned rules. Read + delete only: create/edit forms, plus web's
 * dry-run/apply-to-account actions, aren't built this chunk.
 */
export default function BankRulesScreen() {
  const theme = useTheme<AppTheme>();
  const { activeBusinessId, businesses, user } = useAuth();
  const queryClient = useQueryClient();

  const effectiveRole = (businesses.find(b => b.id === activeBusinessId)?.role_override ?? user?.role ?? 'viewer') as Role;
  const canDelete = hasMinRole(effectiveRole, 'accountant');

  const query = useQuery({
    queryKey: ['bank-rules', activeBusinessId],
    queryFn: () => listBankRules(activeBusinessId!),
    enabled: !!activeBusinessId,
  });

  function handleDelete(rule: BankRule) {
    Alert.alert('Delete this rule?', `"${rule.name}" will no longer auto-categorize matching transactions.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteBankRule(activeBusinessId!, rule.id);
              await queryClient.invalidateQueries({ queryKey: ['bank-rules'] });
            } catch (e) {
              Alert.alert('Could not delete', pickErr(e));
            }
          })();
        },
      },
    ]);
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Bank Rules" />

      {query.isLoading ? (
        <LoadingIndicator />
      ) : query.error ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <FlashList
          data={query.data ?? []}
          keyExtractor={r => r.id}
          contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          ListEmptyComponent={<EmptyState icon="filter-variant" message="No bank rules set up yet." />}
          renderItem={({ item }: { item: BankRule }) => (
            <RuleCard rule={item} theme={theme} canDelete={canDelete} onDelete={() => handleDelete(item)} />
          )}
        />
      )}
    </View>
  );
}

function RuleCard({ rule, theme, canDelete, onDelete }: { rule: BankRule; theme: AppTheme; canDelete: boolean; onDelete: () => void }) {
  return (
    <AppCard style={{ padding: spacing.md }}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold }} numberOfLines={1}>{rule.name}</Text>
          <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }} numberOfLines={2}>
            "{rule.description_contains}" → {rule.offset_account_code} — {rule.offset_account_name}
          </Text>
        </View>
        <StatusBadge status={rule.is_active ? 'green' : 'gray'} label={rule.is_active ? 'Active' : 'Inactive'} />
      </View>
      <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption, marginTop: spacing.xs }}>
        {SIGN_LABEL[rule.sign_filter]}{rule.bank_account_name ? ` · ${rule.bank_account_name}` : ' · Any account'}
        {rule.min_amount ? ` · ≥ $${fmtMoney(rule.min_amount)}` : ''}
        {rule.max_amount ? ` · ≤ $${fmtMoney(rule.max_amount)}` : ''}
      </Text>
      {canDelete ? (
        <Pressable onPress={onDelete} style={styles.deleteIcon} hitSlop={8}>
          <MaterialCommunityIcons name="trash-can-outline" size={18} color={theme.app.destructive} />
        </Pressable>
      ) : null}
    </AppCard>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  deleteIcon: { position: 'absolute', right: spacing.md, bottom: spacing.md },
});
