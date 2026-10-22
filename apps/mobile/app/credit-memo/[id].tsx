import { useMemo, useState } from 'react';
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
import {
  listCreditMemos, getCustomer, listInvoices, getInvoice,
  applyCreditMemoToInvoice, voidCreditMemo, type InvoiceDetail,
} from '../../services/api';
import { pickErr } from '../../services/apiClient';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { ErrorState } from '../../components/ErrorState';
import { fmtMoney, fmtShortDate } from '../../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../../theme';

const CM_BADGE: Record<string, BadgeStatus> = { posted: 'blue', applied: 'green', draft: 'gray', voided: 'red' };

// No GET /credit-memos/:id exists server-side (confirmed by reading the
// route file) — same as web's own CreditMemoDetailPage.tsx, this fetches
// the list and finds the one row, rather than inventing a detail
// endpoint that isn't there.
export default function CreditMemoDetailScreen() {
  const theme = useTheme<AppTheme>();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { activeBusinessId, businesses, user } = useAuth();
  const queryClient = useQueryClient();
  const [voiding, setVoiding] = useState(false);
  const [applying, setApplying] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [invoicePickerOpen, setInvoicePickerOpen] = useState(false);
  const [applyInvoiceId, setApplyInvoiceId] = useState<string | null>(null);
  const [applyAmount, setApplyAmount] = useState('');

  const effectiveRole = (businesses.find(b => b.id === activeBusinessId)?.role_override ?? user?.role ?? 'viewer') as Role;
  const canManage = hasMinRole(effectiveRole, 'accountant');

  const memosQuery = useQuery({
    queryKey: ['credit-memos', activeBusinessId],
    queryFn: () => listCreditMemos(activeBusinessId!),
    enabled: !!activeBusinessId,
  });
  const memo = memosQuery.data?.find(m => m.id === id);

  const customerQuery = useQuery({
    queryKey: ['customer', activeBusinessId, memo?.customer_id],
    queryFn: () => getCustomer(activeBusinessId!, memo!.customer_id),
    enabled: !!activeBusinessId && !!memo,
  });

  const canApply = canManage && memo && (memo.status === 'posted' || memo.status === 'applied') && parseFloat(memo.remaining_amount) > 0;
  const openInvoicesQuery = useQuery({
    queryKey: ['customer-open-invoices', activeBusinessId, memo?.customer_id],
    queryFn: async (): Promise<InvoiceDetail[]> => {
      const rows = await listInvoices(activeBusinessId!, { status: 'posted', customer_id: memo!.customer_id });
      const details = await Promise.all(rows.map(r => getInvoice(activeBusinessId!, r.id)));
      return details.filter(d => parseFloat(d.amount_due) > 0);
    },
    enabled: !!activeBusinessId && !!memo && !!canApply,
  });
  const applyInvoice = openInvoicesQuery.data?.find(d => d.invoice.id === applyInvoiceId);

  async function handleApply() {
    if (!memo || !applyInvoiceId) return;
    const amt = parseFloat(applyAmount);
    if (!(amt > 0)) { setServerError('Enter an amount greater than zero.'); return; }
    if (amt > parseFloat(memo.remaining_amount)) { setServerError("That's more than the credit memo's remaining amount."); return; }
    setServerError(null);
    setApplying(true);
    try {
      await applyCreditMemoToInvoice(activeBusinessId!, memo.id, { invoice_id: applyInvoiceId, applied_amount: applyAmount });
      await queryClient.invalidateQueries({ queryKey: ['credit-memos'] });
      await queryClient.invalidateQueries({ queryKey: ['customer-open-invoices'] });
      setApplyInvoiceId(null);
      setApplyAmount('');
    } catch (e) {
      setServerError(pickErr(e));
    } finally {
      setApplying(false);
    }
  }

  function handleVoid() {
    if (!memo) return;
    Alert.prompt(
      'Void this credit memo?',
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
                await voidCreditMemo(activeBusinessId!, memo.id, reason.trim());
                await queryClient.invalidateQueries({ queryKey: ['credit-memos'] });
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

  if (memosQuery.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <AppHeader title="Credit Memo" leading="back" />
        <LoadingIndicator />
      </View>
    );
  }
  if (memosQuery.error || !memo) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <AppHeader title="Credit Memo" leading="back" />
        <ErrorState onRetry={() => void memosQuery.refetch()} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title={customerQuery.data?.name ?? 'Credit Memo'} leading="back" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.amountBlock}>
          <Text style={{ fontSize: typeScale.caption, color: theme.app.mutedForeground }}>
            {memo.credit_memo_number ? `${memo.credit_memo_number} · ` : ''}{fmtShortDate(memo.memo_date)}
          </Text>
          <Text style={{ fontSize: 32, fontFamily: fontFamily.bold, color: theme.app.foreground, marginTop: 2 }}>
            ${fmtMoney(memo.amount)}
          </Text>
          <Text style={{ fontSize: typeScale.caption, color: theme.app.mutedForeground, marginTop: 2 }}>
            ${fmtMoney(memo.remaining_amount)} remaining
          </Text>
          <View style={{ marginTop: 6 }}>
            <StatusBadge status={CM_BADGE[memo.status] ?? 'gray'} label={memo.status} />
          </View>
        </View>

        {memo.memo ? (
          <AppCard style={{ marginBottom: spacing.md, padding: spacing.md }}>
            <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>Memo</Text>
            <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium, marginTop: 2 }}>{memo.memo}</Text>
          </AppCard>
        ) : null}

        {canApply ? (
          <>
            <Text style={[styles.sectionTitle, { color: theme.app.foreground }]}>Apply to an invoice</Text>
            <AppCard style={{ marginBottom: spacing.md }}>
              <View style={{ padding: spacing.md, gap: spacing.sm }}>
                <PickerField
                  label="Invoice"
                  value={applyInvoice ? `#${applyInvoice.invoice.invoice_number} — $${fmtMoney(applyInvoice.amount_due)} due` : null}
                  placeholder="Pick an open invoice"
                  onPress={() => setInvoicePickerOpen(true)}
                />
                <SearchablePicker
                  visible={invoicePickerOpen}
                  onDismiss={() => setInvoicePickerOpen(false)}
                  title="Pick an invoice"
                  options={(openInvoicesQuery.data ?? []).map(d => ({
                    id: d.invoice.id, label: `#${d.invoice.invoice_number}`, sublabel: `$${fmtMoney(d.amount_due)} due`,
                  }))}
                  onSelect={(invId) => {
                    const inv = openInvoicesQuery.data?.find(d => d.invoice.id === invId);
                    setApplyInvoiceId(invId);
                    if (inv) {
                      setApplyAmount(String(Math.min(parseFloat(inv.amount_due), parseFloat(memo.remaining_amount))));
                    }
                  }}
                />
                {applyInvoiceId ? (
                  <AppTextInput
                    label="Amount to apply"
                    value={applyAmount}
                    onChangeText={(v) => setApplyAmount(v.replace(/[^0-9.]/g, ''))}
                    keyboardType="decimal-pad"
                    left={<Text style={{ color: theme.app.mutedForeground }}>$</Text>}
                  />
                ) : null}
                <AppButton onPress={() => void handleApply()} loading={applying} disabled={!applyInvoiceId}>
                  Apply
                </AppButton>
              </View>
            </AppCard>
          </>
        ) : null}

        {serverError ? <Text style={{ color: theme.app.destructive, marginTop: spacing.md }}>{serverError}</Text> : null}

        {canManage && (memo.status === 'posted' || memo.status === 'applied') ? (
          <AppButton variant="destructive" onPress={handleVoid} loading={voiding} style={{ marginTop: spacing.lg }}>
            Void credit memo
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
