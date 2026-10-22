import { useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { hasMinRole, type Role } from '@accounting/shared';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { AppCard } from '../components/ui/AppCard';
import { AppButton } from '../components/ui/AppButton';
import { AppMenu, AppMenuItem } from '../components/ui/AppMenu';
import { listReconcilableAccounts, getReconciliationStatus } from '../services/api';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { fmtMoney } from '../lib/money';
import { spacing, typeScale, fontFamily, minTouchTarget, type AppTheme } from '../theme';

/**
 * Entry point: pick a reconcilable account (any asset/liability/equity
 * account, not just registered bank accounts — matches
 * listReconcilableAccounts exactly, same accounts web's reconcile picker
 * offers), then Resume an in-progress session or Start a new one. The
 * beginning balance is never entered by hand — it's always the prior
 * completed reconciliation's ending balance, carried forward server-side.
 */
export default function ReconcileScreen() {
  const theme = useTheme<AppTheme>();
  const { activeBusinessId, businesses, user } = useAuth();
  const [accountId, setAccountId] = useState<string | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  const effectiveRole = (businesses.find(b => b.id === activeBusinessId)?.role_override ?? user?.role ?? 'viewer') as Role;
  const canReconcile = hasMinRole(effectiveRole, 'accountant');

  const accountsQuery = useQuery({
    queryKey: ['reconcilable-accounts', activeBusinessId],
    queryFn: () => listReconcilableAccounts(activeBusinessId!),
    enabled: !!activeBusinessId,
  });
  const statusQuery = useQuery({
    queryKey: ['reconciliation-status', activeBusinessId, accountId],
    queryFn: () => getReconciliationStatus(activeBusinessId!, accountId!),
    enabled: !!activeBusinessId && !!accountId,
  });

  const account = accountsQuery.data?.find(a => a.id === accountId);

  if (!canReconcile) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <AppHeader title="Reconcile" />
        <View style={{ padding: spacing.lg, alignItems: 'center' }}>
          <Text style={{ color: theme.app.mutedForeground, textAlign: 'center' }}>
            Your role doesn't have permission to reconcile accounts.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Reconcile" />
      <View style={styles.content}>
        <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption, marginBottom: spacing.xs }}>Account</Text>
        {accountsQuery.isLoading ? (
          <LoadingIndicator size="sm" />
        ) : accountsQuery.error ? (
          <ErrorState onRetry={() => void accountsQuery.refetch()} />
        ) : (
          <AppMenu
            visible={accountMenuOpen}
            onDismiss={() => setAccountMenuOpen(false)}
            anchor={
              <Pressable onPress={() => setAccountMenuOpen(true)} style={[styles.accountField, { borderColor: theme.app.border, backgroundColor: theme.app.surface }]}>
                <MaterialCommunityIcons name="bank-outline" size={18} color={theme.app.mutedForeground} />
                <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium, flex: 1, marginLeft: spacing.sm }} numberOfLines={1}>
                  {account ? `${account.code} — ${account.name}` : 'Pick an account'}
                </Text>
                <MaterialCommunityIcons name="chevron-down" size={18} color={theme.app.mutedForeground} />
              </Pressable>
            }
          >
            {(accountsQuery.data ?? []).map(a => (
              <AppMenuItem key={a.id} title={`${a.code} — ${a.name}`} onPress={() => { setAccountId(a.id); setAccountMenuOpen(false); }} />
            ))}
          </AppMenu>
        )}

        {accountId ? (
          statusQuery.isLoading ? (
            <LoadingIndicator size="sm" />
          ) : statusQuery.error ? (
            <ErrorState onRetry={() => void statusQuery.refetch()} />
          ) : statusQuery.data ? (
            <AppCard style={{ marginTop: spacing.lg, padding: spacing.md }}>
              <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>Beginning balance</Text>
              <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.bold, fontSize: typeScale.h2, marginTop: 2 }}>
                ${fmtMoney(statusQuery.data.beginning_balance)}
              </Text>

              {statusQuery.data.in_progress_id ? (
                <AppButton
                  style={{ marginTop: spacing.md }}
                  onPress={() => router.push({ pathname: '/reconcile/[id]', params: { id: statusQuery.data!.in_progress_id! } })}
                >
                  Resume reconciliation
                </AppButton>
              ) : (
                <AppButton
                  style={{ marginTop: spacing.md }}
                  onPress={() => router.push({ pathname: '/reconcile/start', params: { accountId } })}
                >
                  Start reconciling
                </AppButton>
              )}
            </AppCard>
          ) : null
        ) : null}

        <AppButton variant="outline" style={{ marginTop: spacing.lg }} onPress={() => router.push('/reconcile-history')}>
          View history
        </AppButton>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md },
  accountField: { flexDirection: 'row', alignItems: 'center', minHeight: minTouchTarget, borderWidth: 1, borderRadius: 6, paddingHorizontal: spacing.sm },
});
