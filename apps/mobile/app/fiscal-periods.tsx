import { useState } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { hasMinRole, type Role } from '@accounting/shared';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { AppCard } from '../components/ui/AppCard';
import { AppButton } from '../components/ui/AppButton';
import { StatusBadge } from '../components/ui/StatusBadge';
import { listFiscalPeriods, closeFiscalPeriod, reopenFiscalPeriod, type FiscalPeriod } from '../services/api';
import { pickErr } from '../services/apiClient';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { fmtShortDate } from '../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../theme';

/**
 * Close/reopen is the core workflow here, not optional — a period's
 * `id` is what Books Review will need once it's built (deferred: it's a
 * per-period checklist with no business-wide endpoint, see the plan
 * doc). Close is accountant+; reopen is firm_admin+ with a required
 * reason, matching the server's own stricter gate on undoing a close.
 */
export default function FiscalPeriodsScreen() {
  const theme = useTheme<AppTheme>();
  const { activeBusinessId, businesses, user } = useAuth();
  const queryClient = useQueryClient();
  const [actingId, setActingId] = useState<string | null>(null);

  const effectiveRole = (businesses.find(b => b.id === activeBusinessId)?.role_override ?? user?.role ?? 'viewer') as Role;
  const canClose = hasMinRole(effectiveRole, 'accountant');
  const canReopen = hasMinRole(effectiveRole, 'firm_admin');

  const query = useQuery({
    queryKey: ['fiscal-periods', activeBusinessId],
    queryFn: () => listFiscalPeriods(activeBusinessId!),
    enabled: !!activeBusinessId,
  });

  function handleClose(period: FiscalPeriod) {
    Alert.prompt(
      `Close ${fmtShortDate(period.starts_on)}–${fmtShortDate(period.ends_on)}?`,
      'Nothing more can post to this period once closed. Optional memo:',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Close', style: 'destructive',
          onPress: (memo) => {
            void (async () => {
              setActingId(period.id);
              try {
                await closeFiscalPeriod(activeBusinessId!, period.id, memo || undefined);
                await queryClient.invalidateQueries({ queryKey: ['fiscal-periods'] });
              } catch (e) {
                Alert.alert("Couldn't close period", pickErr(e));
              } finally {
                setActingId(null);
              }
            })();
          },
        },
      ],
      'plain-text',
    );
  }

  function handleReopen(period: FiscalPeriod) {
    Alert.prompt(
      `Reopen ${fmtShortDate(period.starts_on)}–${fmtShortDate(period.ends_on)}?`,
      'Enter a reason:',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reopen', style: 'destructive',
          onPress: (reason) => {
            if (!reason || !reason.trim()) { Alert.alert('A reason is required.'); return; }
            void (async () => {
              setActingId(period.id);
              try {
                await reopenFiscalPeriod(activeBusinessId!, period.id, reason.trim());
                await queryClient.invalidateQueries({ queryKey: ['fiscal-periods'] });
              } catch (e) {
                Alert.alert("Couldn't reopen period", pickErr(e));
              } finally {
                setActingId(null);
              }
            })();
          },
        },
      ],
      'plain-text',
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Fiscal Periods" />

      {query.isLoading ? (
        <LoadingIndicator />
      ) : query.error ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <FlashList
          data={query.data ?? []}
          keyExtractor={p => p.id}
          contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          ListEmptyComponent={<EmptyState icon="calendar-blank-outline" message="No fiscal periods set up." />}
          renderItem={({ item }: { item: FiscalPeriod }) => (
            <PeriodCard
              period={item} theme={theme} acting={actingId === item.id}
              canClose={canClose} canReopen={canReopen}
              onClose={() => handleClose(item)} onReopen={() => handleReopen(item)}
            />
          )}
        />
      )}
    </View>
  );
}

function PeriodCard({
  period, theme, acting, canClose, canReopen, onClose, onReopen,
}: {
  period: FiscalPeriod; theme: AppTheme; acting: boolean; canClose: boolean; canReopen: boolean;
  onClose: () => void; onReopen: () => void;
}) {
  return (
    <AppCard style={{ padding: spacing.md }}>
      <View style={styles.header}>
        <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold }}>
          {fmtShortDate(period.starts_on)} – {fmtShortDate(period.ends_on)}
        </Text>
        <StatusBadge status={period.status === 'open' ? 'green' : 'gray'} label={period.status} />
      </View>
      {period.close_memo ? (
        <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption, marginTop: spacing.xs }}>"{period.close_memo}"</Text>
      ) : null}
      {period.status === 'open' && canClose ? (
        <AppButton variant="outline" onPress={onClose} loading={acting} style={{ marginTop: spacing.sm }}>Close period</AppButton>
      ) : period.status === 'closed' && canReopen ? (
        <AppButton variant="destructive" onPress={onReopen} loading={acting} style={{ marginTop: spacing.sm }}>Reopen period</AppButton>
      ) : null}
    </AppCard>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
