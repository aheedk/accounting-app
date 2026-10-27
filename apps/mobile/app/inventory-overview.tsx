import { useState } from 'react';
import { View, StyleSheet, ScrollView, Pressable, Alert } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { hasMinRole, type Role } from '@accounting/shared';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { AppCard } from '../components/ui/AppCard';
import { AppButton } from '../components/ui/AppButton';
import { DateField } from '../components/DateField';
import { getInventoryOverview, postOpeningInventoryBalance } from '../services/api';
import { pickErr } from '../services/apiClient';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { fmtMoney, fmtShortDate } from '../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../theme';

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function InventoryOverviewScreen() {
  const theme = useTheme<AppTheme>();
  const { activeBusinessId, businesses, user } = useAuth();
  const queryClient = useQueryClient();
  const effectiveRole = (businesses.find(b => b.id === activeBusinessId)?.role_override ?? user?.role ?? 'viewer') as Role;
  const canPost = hasMinRole(effectiveRole, 'accountant');
  const [posting, setPosting] = useState(false);
  const [entryDate, setEntryDate] = useState(todayIso());
  const [showPostForm, setShowPostForm] = useState(false);

  const query = useQuery({
    queryKey: ['inventory-overview', activeBusinessId],
    queryFn: () => getInventoryOverview(activeBusinessId!),
    enabled: !!activeBusinessId,
  });

  async function handlePostOpeningBalance() {
    setPosting(true);
    try {
      const result = await postOpeningInventoryBalance(activeBusinessId!, entryDate);
      await queryClient.invalidateQueries({ queryKey: ['inventory-overview'] });
      setShowPostForm(false);
      if (result.movement_count === 0) {
        Alert.alert('Nothing to post', 'There is no unposted stock value right now.');
      } else {
        Alert.alert('Posted', `${result.movement_count} movement${result.movement_count === 1 ? '' : 's'} posted, $${fmtMoney(result.value)} total.`);
      }
    } catch (e) {
      Alert.alert("Couldn't post opening balance", pickErr(e));
    } finally {
      setPosting(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Inventory Overview" />

      {query.isLoading ? (
        <LoadingIndicator />
      ) : query.error || !query.data ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}>
          <View style={styles.summaryRow}>
            <AppCard style={styles.summaryCard}>
              <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption, fontFamily: fontFamily.medium }}>Items</Text>
              <Text style={{ color: theme.app.foreground, fontSize: typeScale.h3, fontFamily: fontFamily.bold }}>{query.data.total_items_count}</Text>
            </AppCard>
            <AppCard style={styles.summaryCard}>
              <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption, fontFamily: fontFamily.medium }}>Stock value</Text>
              <Text style={{ color: theme.app.foreground, fontSize: typeScale.h3, fontFamily: fontFamily.bold }}>${fmtMoney(query.data.total_stock_value)}</Text>
            </AppCard>
          </View>

          {parseFloat(query.data.unposted_stock_value) !== 0 ? (
            <AppCard style={{ padding: spacing.md, marginBottom: spacing.lg }}>
              <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium }}>
                ${fmtMoney(query.data.unposted_stock_value)} of stock value hasn't been posted to the ledger yet.
              </Text>
              {canPost ? (
                showPostForm ? (
                  <View style={{ marginTop: spacing.sm, gap: spacing.sm }}>
                    <DateField label="Entry date" value={entryDate} onChange={setEntryDate} />
                    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                      <AppButton variant="outline" onPress={() => setShowPostForm(false)} style={{ flex: 1 }}>Cancel</AppButton>
                      <AppButton onPress={() => void handlePostOpeningBalance()} loading={posting} style={{ flex: 1 }}>Post</AppButton>
                    </View>
                  </View>
                ) : (
                  <AppButton variant="outline" onPress={() => setShowPostForm(true)} style={{ marginTop: spacing.sm }}>Post opening balance</AppButton>
                )
              ) : null}
            </AppCard>
          ) : null}

          <Text style={{ fontSize: typeScale.h3, fontFamily: fontFamily.semibold, color: theme.app.foreground, marginBottom: spacing.sm }}>Recent receipts</Text>
          <AppCard style={{ padding: 0, marginBottom: spacing.lg }}>
            {query.data.recent_receipts.length === 0 ? (
              <View style={{ padding: spacing.md }}><Text style={{ color: theme.app.mutedForeground }}>No receipts yet.</Text></View>
            ) : (
              query.data.recent_receipts.map((r, i) => (
                <Pressable
                  key={r.id}
                  onPress={() => router.push('/item-receipts')}
                  style={[styles.row, i !== query.data!.recent_receipts.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.app.border }]}
                >
                  <Text style={{ color: theme.app.foreground, flex: 1 }}>{r.po_number}</Text>
                  <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>{fmtShortDate(r.receipt_date)}</Text>
                </Pressable>
              ))
            )}
          </AppCard>

          <Text style={{ fontSize: typeScale.h3, fontFamily: fontFamily.semibold, color: theme.app.foreground, marginBottom: spacing.sm }}>Recent sales (fulfilled)</Text>
          <AppCard style={{ padding: 0 }}>
            {query.data.recent_sales.length === 0 ? (
              <View style={{ padding: spacing.md }}><Text style={{ color: theme.app.mutedForeground }}>No fulfilled sales orders yet.</Text></View>
            ) : (
              query.data.recent_sales.map((s, i) => (
                <Pressable
                  key={s.id}
                  onPress={() => router.push({ pathname: '/sales-order/[id]', params: { id: s.id } })}
                  style={[styles.row, i !== query.data!.recent_sales.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.app.border }]}
                >
                  <Text style={{ color: theme.app.foreground, flex: 1 }}>{s.so_number}</Text>
                  <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>{fmtShortDate(s.order_date)}</Text>
                </Pressable>
              ))
            )}
          </AppCard>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  summaryRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  summaryCard: { flex: 1, padding: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
