import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Switch, useTheme } from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { hasMinRole, type Role } from '@accounting/shared';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { AppCard } from '../components/ui/AppCard';
import { listRecurringTemplates, setRecurringTemplateActive, type RecurringTemplateRow } from '../services/api';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { fmtShortDate } from '../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../theme';

const TYPE_LABEL: Record<string, string> = {
  journal_entry: 'Journal Entry', invoice: 'Invoice', bill: 'Bill', deposit: 'Deposit', expense: 'Expense', check: 'Check',
};
const RECURRENCE_LABEL: Record<string, string> = { weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };

/** Read-only list + pause/resume toggle (PATCH {is_active} — the only
 * mutation that's simple enough to wire this chunk; creating a template
 * or editing its payload/run-now/delete aren't built here. */
export default function RecurringTemplatesScreen() {
  const theme = useTheme<AppTheme>();
  const { activeBusinessId, businesses, user } = useAuth();
  const queryClient = useQueryClient();

  const effectiveRole = (businesses.find(b => b.id === activeBusinessId)?.role_override ?? user?.role ?? 'viewer') as Role;
  const canToggle = hasMinRole(effectiveRole, 'accountant');

  const query = useQuery({
    queryKey: ['recurring-templates', activeBusinessId],
    queryFn: () => listRecurringTemplates(activeBusinessId!),
    enabled: !!activeBusinessId,
  });

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Recurring Transactions" />

      {query.isLoading ? (
        <LoadingIndicator />
      ) : query.error ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <FlashList
          data={query.data ?? []}
          keyExtractor={t => t.id}
          contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          ListEmptyComponent={<EmptyState icon="autorenew" message="No recurring templates yet." />}
          renderItem={({ item }: { item: RecurringTemplateRow }) => (
            <TemplateCard template={item} theme={theme} canToggle={canToggle} businessId={activeBusinessId!}
              onToggled={() => void queryClient.invalidateQueries({ queryKey: ['recurring-templates'] })} />
          )}
        />
      )}
    </View>
  );
}

function TemplateCard({
  template, theme, canToggle, businessId, onToggled,
}: { template: RecurringTemplateRow; theme: AppTheme; canToggle: boolean; businessId: string; onToggled: () => void }) {
  const [toggling, setToggling] = useState(false);

  async function toggle(next: boolean) {
    setToggling(true);
    try {
      await setRecurringTemplateActive(businessId, template.id, next);
      onToggled();
    } finally {
      setToggling(false);
    }
  }

  return (
    <AppCard style={{ padding: spacing.md }}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold }} numberOfLines={1}>{template.name}</Text>
          <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>
            {TYPE_LABEL[template.template_type] ?? template.template_type} · {RECURRENCE_LABEL[template.recurrence] ?? template.recurrence}
          </Text>
        </View>
        <Switch value={template.is_active} onValueChange={toggle} disabled={!canToggle || toggling} color={theme.app.primary} />
      </View>
      <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption, marginTop: spacing.xs }}>
        Next: {fmtShortDate(template.next_run_date)}
        {template.last_run_at ? ` · Last ran ${fmtShortDate(template.last_run_at)}` : ''}
      </Text>
    </AppCard>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
