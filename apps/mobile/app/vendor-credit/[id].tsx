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
import { AppTextInput } from '../../components/ui/AppTextInput';
import { StatusBadge, type BadgeStatus } from '../../components/ui/StatusBadge';
import { PickerField } from '../../components/PickerField';
import { SearchablePicker } from '../../components/SearchablePicker';
import { listVendorCredits, getVendor, listBills, applyVendorCreditToBill, voidVendorCredit } from '../../services/api';
import { pickErr } from '../../services/apiClient';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { ErrorState } from '../../components/ErrorState';
import { fmtMoney, fmtShortDate } from '../../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../../theme';

const VC_BADGE: Record<string, BadgeStatus> = { posted: 'blue', applied: 'green', draft: 'gray', voided: 'red' };

// Vendor-side mirror of app/credit-memo/[id].tsx — same list-and-find
// pattern (no GET detail route exists here either) and the same
// apply-inline / void-with-reason flow. Simpler than the AR side in one
// way: listBills already returns open_balance per row, so the open-bills
// picker doesn't need the N+1 detail-fetch invoices required.
export default function VendorCreditDetailScreen() {
  const theme = useTheme<AppTheme>();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { activeBusinessId, businesses, user } = useAuth();
  const queryClient = useQueryClient();
  const [voiding, setVoiding] = useState(false);
  const [applying, setApplying] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [billPickerOpen, setBillPickerOpen] = useState(false);
  const [applyBillId, setApplyBillId] = useState<string | null>(null);
  const [applyAmount, setApplyAmount] = useState('');

  const effectiveRole = (businesses.find(b => b.id === activeBusinessId)?.role_override ?? user?.role ?? 'viewer') as Role;
  const canManage = hasMinRole(effectiveRole, 'accountant');

  const creditsQuery = useQuery({
    queryKey: ['vendor-credits', activeBusinessId],
    queryFn: () => listVendorCredits(activeBusinessId!),
    enabled: !!activeBusinessId,
  });
  const credit = creditsQuery.data?.find(c => c.id === id);

  const vendorQuery = useQuery({
    queryKey: ['vendor', activeBusinessId, credit?.vendor_id],
    queryFn: () => getVendor(activeBusinessId!, credit!.vendor_id),
    enabled: !!activeBusinessId && !!credit,
  });

  const canApply = canManage && credit && (credit.status === 'posted' || credit.status === 'applied') && parseFloat(credit.remaining_amount) > 0;
  const openBillsQuery = useQuery({
    queryKey: ['vendor-open-bills', activeBusinessId, credit?.vendor_id],
    queryFn: async () => {
      const rows = await listBills(activeBusinessId!, { status: 'posted', vendor_id: credit!.vendor_id });
      return rows.filter(b => parseFloat(b.open_balance) > 0);
    },
    enabled: !!activeBusinessId && !!credit && !!canApply,
  });
  const applyBill = openBillsQuery.data?.find(b => b.id === applyBillId);

  async function handleApply() {
    if (!credit || !applyBillId) return;
    const amt = parseFloat(applyAmount);
    if (!(amt > 0)) { setServerError('Enter an amount greater than zero.'); return; }
    if (amt > parseFloat(credit.remaining_amount)) { setServerError("That's more than the vendor credit's remaining amount."); return; }
    setServerError(null);
    setApplying(true);
    try {
      await applyVendorCreditToBill(activeBusinessId!, credit.id, { bill_id: applyBillId, applied_amount: applyAmount });
      await queryClient.invalidateQueries({ queryKey: ['vendor-credits'] });
      await queryClient.invalidateQueries({ queryKey: ['vendor-open-bills'] });
      setApplyBillId(null);
      setApplyAmount('');
    } catch (e) {
      setServerError(pickErr(e));
    } finally {
      setApplying(false);
    }
  }

  function handleVoid() {
    if (!credit) return;
    Alert.prompt(
      'Void this vendor credit?',
      'This reverses it and cannot be undone. Enter a reason:',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Void', style: 'destructive',
          onPress: (reason) => {
            if (!reason || !reason.trim()) { Alert.alert('A void reason is required.'); return; }
            void (async () => {
              setVoiding(true);
              try {
                await voidVendorCredit(activeBusinessId!, credit.id, reason.trim());
                await queryClient.invalidateQueries({ queryKey: ['vendor-credits'] });
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

  if (creditsQuery.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <AppHeader title="Vendor Credit" leading="back" />
        <LoadingIndicator />
      </View>
    );
  }
  if (creditsQuery.error || !credit) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <AppHeader title="Vendor Credit" leading="back" />
        <ErrorState onRetry={() => void creditsQuery.refetch()} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title={vendorQuery.data?.name ?? 'Vendor Credit'} leading="back" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.amountBlock}>
          <Text style={{ fontSize: typeScale.caption, color: theme.app.mutedForeground }}>
            {credit.vendor_credit_number ? `${credit.vendor_credit_number} · ` : ''}{fmtShortDate(credit.credit_date)}
          </Text>
          <Text style={{ fontSize: 32, fontFamily: fontFamily.bold, color: theme.app.foreground, marginTop: 2 }}>
            ${fmtMoney(credit.amount)}
          </Text>
          <Text style={{ fontSize: typeScale.caption, color: theme.app.mutedForeground, marginTop: 2 }}>
            ${fmtMoney(credit.remaining_amount)} remaining
          </Text>
          <View style={{ marginTop: 6 }}>
            <StatusBadge status={VC_BADGE[credit.status] ?? 'gray'} label={credit.status} />
          </View>
        </View>

        {credit.memo ? (
          <AppCard style={{ marginBottom: spacing.md, padding: spacing.md }}>
            <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>Memo</Text>
            <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium, marginTop: 2 }}>{credit.memo}</Text>
          </AppCard>
        ) : null}

        {canApply ? (
          <>
            <Text style={[styles.sectionTitle, { color: theme.app.foreground }]}>Apply to a bill</Text>
            <AppCard style={{ marginBottom: spacing.md }}>
              <View style={{ padding: spacing.md, gap: spacing.sm }}>
                <PickerField
                  label="Bill"
                  value={applyBill ? `${applyBill.bill_number ? `#${applyBill.bill_number}` : 'Bill'} — $${fmtMoney(applyBill.open_balance)} due` : null}
                  placeholder="Pick an open bill"
                  onPress={() => setBillPickerOpen(true)}
                />
                <SearchablePicker
                  visible={billPickerOpen}
                  onDismiss={() => setBillPickerOpen(false)}
                  title="Pick a bill"
                  options={(openBillsQuery.data ?? []).map(b => ({
                    id: b.id, label: b.bill_number ? `#${b.bill_number}` : 'Bill', sublabel: `$${fmtMoney(b.open_balance)} due`,
                  }))}
                  onSelect={(billId) => {
                    const bill = openBillsQuery.data?.find(b => b.id === billId);
                    setApplyBillId(billId);
                    if (bill) {
                      setApplyAmount(String(Math.min(parseFloat(bill.open_balance), parseFloat(credit.remaining_amount))));
                    }
                  }}
                />
                {applyBillId ? (
                  <AppTextInput
                    label="Amount to apply"
                    value={applyAmount}
                    onChangeText={(v) => setApplyAmount(v.replace(/[^0-9.]/g, ''))}
                    keyboardType="decimal-pad"
                    left={<Text style={{ color: theme.app.mutedForeground }}>$</Text>}
                  />
                ) : null}
                <AppButton onPress={() => void handleApply()} loading={applying} disabled={!applyBillId}>
                  Apply
                </AppButton>
              </View>
            </AppCard>
          </>
        ) : null}

        {serverError ? <Text style={{ color: theme.app.destructive, marginTop: spacing.md }}>{serverError}</Text> : null}

        {canManage && (credit.status === 'posted' || credit.status === 'applied') ? (
          <AppButton variant="destructive" onPress={handleVoid} loading={voiding} style={{ marginTop: spacing.lg }}>
            Void vendor credit
          </AppButton>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  amountBlock: { alignItems: 'flex-start', marginBottom: spacing.md },
  sectionTitle: { fontSize: typeScale.h3, fontFamily: fontFamily.semibold, marginBottom: spacing.sm, marginTop: spacing.sm },
});
