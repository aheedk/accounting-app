import { useState } from 'react';
import { View, StyleSheet, ScrollView, Alert } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, router } from 'expo-router';
import { hasMinRole, type Role } from '@accounting/shared';
import { useAuth } from '../../hooks/useAuth';
import { AppHeader } from '../../components/AppHeader';
import { AppCard } from '../../components/ui/AppCard';
import { AppButton } from '../../components/ui/AppButton';
import { StatusBadge, statusToBadge } from '../../components/ui/StatusBadge';
import { getBillPayment, listVendors, voidBillPayment } from '../../services/api';
import { pickErr } from '../../services/apiClient';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { ErrorState } from '../../components/ErrorState';
import { fmtMoney, fmtShortDate } from '../../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../../theme';

// Vendor-side mirror of app/payment/[id].tsx — same Void guard (zero
// applications required, same as the server's own hard check) and same
// Alert.prompt void-reason flow.
export default function BillPaymentDetailScreen() {
  const theme = useTheme<AppTheme>();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { activeBusinessId, businesses, user } = useAuth();
  const queryClient = useQueryClient();
  const [voiding, setVoiding] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const effectiveRole = (businesses.find(b => b.id === activeBusinessId)?.role_override ?? user?.role ?? 'viewer') as Role;
  const canVoid = hasMinRole(effectiveRole, 'accountant');

  const query = useQuery({
    queryKey: ['bill-payment-detail', activeBusinessId, id],
    queryFn: () => getBillPayment(activeBusinessId!, id!),
    enabled: !!activeBusinessId && !!id,
  });
  const vendorsQuery = useQuery({
    queryKey: ['vendors', activeBusinessId],
    queryFn: () => listVendors(activeBusinessId!),
    enabled: !!activeBusinessId, staleTime: 5 * 60_000,
  });

  function handleVoid() {
    if (!query.data) return;
    if (query.data.applications.length > 0) {
      Alert.alert(
        "Can't void this payment",
        'This payment is applied to one or more bills. Remove those applications first (on the web app) before voiding.',
      );
      return;
    }
    Alert.prompt(
      'Void this payment?',
      'This reverses the payment and cannot be undone. Enter a reason:',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Void', style: 'destructive',
          onPress: (reason) => {
            if (!reason || !reason.trim()) { Alert.alert('A void reason is required.'); return; }
            void (async () => {
              setVoiding(true);
              try {
                await voidBillPayment(activeBusinessId!, id!, reason.trim());
                await queryClient.invalidateQueries({ queryKey: ['bill-payments'] });
                await queryClient.invalidateQueries({ queryKey: ['bill-payment-detail'] });
                router.back();
              } catch (e) {
                setServerError(pickErr(e));
              } finally {
                setVoiding(false);
              }
            })();
          },
        },
      ],
      'plain-text',
    );
  }

  if (query.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <AppHeader title="Bill Payment" leading="back" />
        <LoadingIndicator />
      </View>
    );
  }
  if (query.error || !query.data) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <AppHeader title="Bill Payment" leading="back" />
        <ErrorState onRetry={() => void query.refetch()} />
      </View>
    );
  }

  const { bill_payment, applications } = query.data;
  const vendorName = vendorsQuery.data?.find(v => v.id === bill_payment.vendor_id)?.name ?? 'Vendor';

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title={vendorName} leading="back" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.amountBlock}>
          <Text style={{ fontSize: typeScale.caption, color: theme.app.mutedForeground }}>
            Bill payment · {fmtShortDate(bill_payment.payment_date)}
          </Text>
          <Text style={{ fontSize: 32, fontFamily: fontFamily.bold, color: theme.app.foreground, marginTop: 2 }}>
            ${fmtMoney(bill_payment.amount)}
          </Text>
          <View style={{ marginTop: 6 }}>
            <StatusBadge status={statusToBadge(bill_payment.status)} label={bill_payment.status} />
          </View>
        </View>

        <AppCard style={{ marginBottom: spacing.md }}>
          <FieldRow label="Method" value={bill_payment.payment_method} theme={theme} />
          <FieldRow label="Reference" value={bill_payment.reference ?? '—'} theme={theme} />
          <FieldRow label="Unapplied" value={`$${fmtMoney(bill_payment.unapplied_amount)}`} theme={theme} />
          {bill_payment.memo ? <FieldRow label="Memo" value={bill_payment.memo} theme={theme} last /> : null}
        </AppCard>

        <Text style={[styles.sectionTitle, { color: theme.app.foreground }]}>Applied to</Text>
        {applications.length === 0 ? (
          <Text style={{ color: theme.app.mutedForeground }}>Not applied to any bill.</Text>
        ) : (
          <AppCard>
            {applications.map((a, i) => (
              <View
                key={a.id}
                style={[styles.lineRow, i < applications.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.app.border }]}
              >
                <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium }}>Bill #{a.bill_number}</Text>
                <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold }}>${fmtMoney(a.applied_amount)}</Text>
              </View>
            ))}
          </AppCard>
        )}

        {serverError ? <Text style={{ color: theme.app.destructive, marginTop: spacing.md }}>{serverError}</Text> : null}

        {canVoid && bill_payment.status === 'posted' ? (
          <AppButton variant="destructive" onPress={handleVoid} loading={voiding} style={{ marginTop: spacing.lg }}>
            Void payment
          </AppButton>
        ) : null}
      </ScrollView>
    </View>
  );
}

function FieldRow({ label, value, theme, last }: { label: string; value: string; theme: AppTheme; last?: boolean }) {
  return (
    <View style={[styles.fieldRow, last && { marginBottom: 0 }]}>
      <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>{label}</Text>
      <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium, marginTop: 1, textTransform: 'capitalize' }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  amountBlock: { alignItems: 'flex-start', marginBottom: spacing.md },
  sectionTitle: { fontSize: typeScale.h3, fontFamily: fontFamily.semibold, marginBottom: spacing.sm, marginTop: spacing.sm },
  fieldRow: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.xs },
  lineRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
