import { useMemo, useState } from 'react';
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
import { AppSegmentedControl } from '../components/ui/AppSegmentedControl';
import { AppMenu, AppMenuItem } from '../components/ui/AppMenu';
import { StatusBadge } from '../components/ui/StatusBadge';
import {
  listChartOfAccounts, listBudgets, createBudget, deleteBudget, updateBudget,
  getBudget, setBudgetLine, getBudgetVariance,
  type Budget, type BudgetStatus,
} from '../services/api';
import { pickErr } from '../services/apiClient';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { fmtMoney } from '../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../theme';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function lineKey(accountId: string, monthOffset: number): string {
  return `${accountId}:${monthOffset}`;
}

export default function FinancialPlanningScreen() {
  const theme = useTheme<AppTheme>();
  const { activeBusinessId, businesses, user } = useAuth();
  const queryClient = useQueryClient();
  const effectiveRole = (businesses.find(b => b.id === activeBusinessId)?.role_override ?? user?.role ?? 'viewer') as Role;
  const canEdit = hasMinRole(effectiveRole, 'accountant');
  const canDelete = hasMinRole(effectiveRole, 'firm_admin');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newYear, setNewYear] = useState(String(new Date().getFullYear()));

  const budgetsQuery = useQuery({
    queryKey: ['budgets', activeBusinessId],
    queryFn: () => listBudgets(activeBusinessId!),
    enabled: !!activeBusinessId,
  });

  if (selectedId) {
    return (
      <BudgetDetail
        businessId={activeBusinessId!}
        budgetId={selectedId}
        canEdit={canEdit}
        canDelete={canDelete}
        theme={theme}
        onBack={() => setSelectedId(null)}
        onDeleted={() => { setSelectedId(null); void queryClient.invalidateQueries({ queryKey: ['budgets'] }); }}
      />
    );
  }

  async function handleCreate() {
    const year = parseInt(newYear, 10);
    if (!newName.trim() || !Number.isFinite(year)) { Alert.alert('Enter a name and a valid year.'); return; }
    try {
      const created = await createBudget(activeBusinessId!, newName.trim(), year);
      await queryClient.invalidateQueries({ queryKey: ['budgets'] });
      setCreating(false);
      setNewName('');
      setSelectedId(created.id);
    } catch (e) {
      Alert.alert("Couldn't create budget", pickErr(e));
    }
  }

  function handleDelete(budget: Budget) {
    Alert.alert('Delete this budget?', `"${budget.name}" and all its lines will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteBudget(activeBusinessId!, budget.id);
              await queryClient.invalidateQueries({ queryKey: ['budgets'] });
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
      <AppHeader title="Financial Planning" />
      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}>
        {canEdit ? (
          creating ? (
            <AppCard style={{ padding: spacing.md, marginBottom: spacing.md, gap: spacing.sm }}>
              <AppTextInput label="Budget name" value={newName} onChangeText={setNewName} placeholder="e.g. FY26 Operating Budget" />
              <AppTextInput label="Fiscal year" value={newYear} onChangeText={setNewYear} keyboardType="number-pad" />
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <AppButton variant="outline" onPress={() => setCreating(false)} style={{ flex: 1 }}>Cancel</AppButton>
                <AppButton onPress={() => void handleCreate()} style={{ flex: 1 }}>Create</AppButton>
              </View>
            </AppCard>
          ) : (
            <AppButton onPress={() => setCreating(true)} style={{ marginBottom: spacing.md }}>New Budget</AppButton>
          )
        ) : null}

        {budgetsQuery.isLoading ? (
          <LoadingIndicator />
        ) : budgetsQuery.error ? (
          <ErrorState onRetry={() => void budgetsQuery.refetch()} />
        ) : !budgetsQuery.data || budgetsQuery.data.length === 0 ? (
          <EmptyState icon="chart-box-outline" message="No budgets yet." />
        ) : (
          <AppCard style={{ padding: 0 }}>
            {budgetsQuery.data.map((b, i) => (
              <Pressable
                key={b.id}
                onPress={() => setSelectedId(b.id)}
                style={[styles.listRow, i !== budgetsQuery.data!.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.app.border }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium }} numberOfLines={1}>{b.name}</Text>
                  <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>FY{b.fiscal_year}</Text>
                </View>
                <StatusBadge status={b.status === 'active' ? 'green' : b.status === 'archived' ? 'gray' : 'blue'} label={b.status} />
                {canDelete ? (
                  <Pressable onPress={() => handleDelete(b)} hitSlop={8} style={{ marginLeft: spacing.sm }}>
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

function BudgetDetail({
  businessId, budgetId, canEdit, canDelete, theme, onBack, onDeleted,
}: {
  businessId: string; budgetId: string; canEdit: boolean; canDelete: boolean; theme: AppTheme;
  onBack: () => void; onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'edit' | 'variance'>('edit');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  const budgetQuery = useQuery({
    queryKey: ['budget', businessId, budgetId],
    queryFn: () => getBudget(businessId, budgetId),
    enabled: !!businessId,
  });

  const accountsQuery = useQuery({
    queryKey: ['coa', businessId],
    queryFn: () => listChartOfAccounts(businessId),
    enabled: !!businessId,
  });

  const varianceQuery = useQuery({
    queryKey: ['budget-variance', businessId, budgetId],
    queryFn: () => getBudgetVariance(businessId, budgetId),
    enabled: !!businessId && mode === 'variance',
  });

  const activeAccounts = useMemo(() => accountsQuery.data?.filter(a => a.is_active) ?? [], [accountsQuery.data]);
  const selectedAccount = activeAccounts.find(a => a.id === accountId) ?? activeAccounts[0] ?? null;

  const linesByMonth = useMemo(() => {
    const map = new Map<number, string>();
    if (budgetQuery.data && selectedAccount) {
      for (const line of budgetQuery.data.lines) {
        if (line.account_id === selectedAccount.id) map.set(line.month_offset, line.amount);
      }
    }
    return map;
  }, [budgetQuery.data, selectedAccount]);

  const varianceByMonth = useMemo(() => {
    const map = new Map<number, { budget: string; actual: string; variance: string }>();
    if (varianceQuery.data && selectedAccount) {
      for (const row of varianceQuery.data) {
        if (row.account_id === selectedAccount.id) map.set(row.month_offset, row);
      }
    }
    return map;
  }, [varianceQuery.data, selectedAccount]);

  async function handleStatusChange(status: BudgetStatus) {
    try {
      await updateBudget(businessId, budgetId, { status });
      await queryClient.invalidateQueries({ queryKey: ['budget', businessId, budgetId] });
      await queryClient.invalidateQueries({ queryKey: ['budgets'] });
    } catch (e) {
      Alert.alert("Couldn't update status", pickErr(e));
    }
  }

  async function handleCellSave(monthOffset: number, raw: string) {
    if (!selectedAccount) return;
    const trimmed = raw.trim() === '' ? '0' : raw.trim();
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) { Alert.alert('Invalid amount', raw); return; }
    try {
      await setBudgetLine(businessId, budgetId, selectedAccount.id, monthOffset, trimmed);
      await queryClient.invalidateQueries({ queryKey: ['budget', businessId, budgetId] });
    } catch (e) {
      Alert.alert("Couldn't save amount", pickErr(e));
    }
  }

  function handleDelete() {
    if (!budgetQuery.data) return;
    Alert.alert('Delete this budget?', `"${budgetQuery.data.name}" and all its lines will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteBudget(businessId, budgetId);
              onDeleted();
            } catch (e) {
              Alert.alert('Could not delete', pickErr(e));
            }
          })();
        },
      },
    ]);
  }

  if (budgetQuery.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <AppHeader title="Budget" />
        <LoadingIndicator />
      </View>
    );
  }
  if (budgetQuery.error || !budgetQuery.data) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <AppHeader title="Budget" />
        <ErrorState onRetry={() => void budgetQuery.refetch()} />
      </View>
    );
  }

  const budget = budgetQuery.data;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title={budget.name} />
      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}>
        <Pressable onPress={onBack} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: spacing.md }}>
          <MaterialCommunityIcons name="chevron-left" size={18} color={theme.app.primary} />
          <Text style={{ color: theme.app.primary, fontFamily: fontFamily.medium }}>All budgets</Text>
        </Pressable>

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md }}>
          <Text style={{ color: theme.app.mutedForeground }}>FY{budget.fiscal_year}</Text>
          {canDelete ? (
            <Pressable onPress={handleDelete} hitSlop={8}>
              <MaterialCommunityIcons name="trash-can-outline" size={20} color={theme.app.destructive} />
            </Pressable>
          ) : null}
        </View>

        {canEdit ? (
          <View style={{ marginBottom: spacing.md }}>
            <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium, fontSize: typeScale.label, marginBottom: 4 }}>Status</Text>
            <AppSegmentedControl
              value={budget.status}
              onChange={status => void handleStatusChange(status)}
              options={[{ value: 'draft', label: 'Draft' }, { value: 'active', label: 'Active' }, { value: 'archived', label: 'Archived' }]}
            />
          </View>
        ) : (
          <View style={{ marginBottom: spacing.md }}>
            <StatusBadge status={budget.status === 'active' ? 'green' : budget.status === 'archived' ? 'gray' : 'blue'} label={budget.status} />
          </View>
        )}

        <View style={{ marginBottom: spacing.md }}>
          <AppSegmentedControl
            value={mode}
            onChange={setMode}
            options={[{ value: 'edit', label: 'Edit' }, { value: 'variance', label: 'Variance' }]}
          />
        </View>

        <AppMenu
          visible={accountMenuOpen}
          onDismiss={() => setAccountMenuOpen(false)}
          anchor={
            <AppChip
              icon="chevron-down"
              label={selectedAccount ? `${selectedAccount.code} — ${selectedAccount.name}` : 'Select account'}
              onPress={() => setAccountMenuOpen(true)}
            />
          }
        >
          {activeAccounts.map(a => (
            <AppMenuItem key={a.id} title={`${a.code} — ${a.name}`} onPress={() => { setAccountId(a.id); setAccountMenuOpen(false); }} />
          ))}
        </AppMenu>

        {!selectedAccount ? null : mode === 'edit' ? (
          <AppCard style={{ marginTop: spacing.md }}>
            {MONTHS.map((label, offset) => (
              <MonthCell
                key={offset} label={label} value={linesByMonth.get(offset) ?? '0'}
                editable={canEdit} theme={theme} last={offset === 11}
                onSave={v => void handleCellSave(offset, v)}
              />
            ))}
          </AppCard>
        ) : varianceQuery.isLoading ? (
          <LoadingIndicator />
        ) : (
          <AppCard style={{ padding: 0, marginTop: spacing.md }}>
            <View style={[styles.varianceRow, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.app.border }]}>
              <Text style={{ flex: 1, color: theme.app.mutedForeground, fontSize: typeScale.caption, fontFamily: fontFamily.semibold }}>Month</Text>
              <Text style={{ width: 80, textAlign: 'right', color: theme.app.mutedForeground, fontSize: typeScale.caption, fontFamily: fontFamily.semibold }}>Budget</Text>
              <Text style={{ width: 80, textAlign: 'right', color: theme.app.mutedForeground, fontSize: typeScale.caption, fontFamily: fontFamily.semibold }}>Actual</Text>
              <Text style={{ width: 80, textAlign: 'right', color: theme.app.mutedForeground, fontSize: typeScale.caption, fontFamily: fontFamily.semibold }}>Variance</Text>
            </View>
            {MONTHS.map((label, offset) => {
              const row = varianceByMonth.get(offset);
              const v = row ? parseFloat(row.variance) : 0;
              return (
                <View key={offset} style={[styles.varianceRow, offset !== 11 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.app.border }]}>
                  <Text style={{ flex: 1, color: theme.app.foreground }}>{label}</Text>
                  <Text style={{ width: 80, textAlign: 'right', color: theme.app.foreground }}>${fmtMoney(row?.budget ?? '0')}</Text>
                  <Text style={{ width: 80, textAlign: 'right', color: theme.app.foreground }}>${fmtMoney(row?.actual ?? '0')}</Text>
                  <Text style={{ width: 80, textAlign: 'right', fontFamily: fontFamily.medium, color: v > 0 ? theme.app.statusGreenFg : v < 0 ? theme.app.statusRedFg : theme.app.mutedForeground }}>
                    ${fmtMoney(row?.variance ?? '0')}
                  </Text>
                </View>
              );
            })}
          </AppCard>
        )}
      </ScrollView>
    </View>
  );
}

function MonthCell({
  label, value, editable, theme, last, onSave,
}: { label: string; value: string; editable: boolean; theme: AppTheme; last: boolean; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value);

  return (
    <View style={[styles.monthRow, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.app.border }]}>
      <Text style={{ width: 48, color: theme.app.foreground }}>{label}</Text>
      {editable ? (
        <AppTextInput
          value={draft}
          onChangeText={setDraft}
          onBlur={() => { if (draft !== value) onSave(draft); }}
          keyboardType="numbers-and-punctuation"
          containerStyle={{ flex: 1 }}
        />
      ) : (
        <Text style={{ flex: 1, textAlign: 'right', color: theme.app.foreground, fontFamily: fontFamily.medium }}>${fmtMoney(value)}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  listRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  varianceRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  monthRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
});
