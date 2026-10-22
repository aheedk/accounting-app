import { useState } from 'react';
import { View, StyleSheet, ScrollView, Pressable, Linking, RefreshControl } from 'react-native';
import { Text, Appbar, Card, useTheme } from 'react-native-paper';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../hooks/useAuth';
import {
  getVendor, listVendors, listTransactions, listVendorNotes, addVendorNote, type TransactionRow,
} from '../../services/api';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { ErrorState } from '../../components/ErrorState';
import { EmptyState } from '../../components/EmptyState';
import { AppButton } from '../../components/ui/AppButton';
import { AppSegmentedControl } from '../../components/ui/AppSegmentedControl';
import { AppTextInput } from '../../components/ui/AppTextInput';
import { pickErr } from '../../services/apiClient';
import { fmtMoney, fmtShortDate } from '../../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../../theme';

// Same 3-tab layout as web's vendor detail (Transaction List, Vendor
// Details, Notes) — Transactions first to match web's own tab order.
type Tab = 'transactions' | 'details' | 'notes';

export default function VendorDetailScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { activeBusinessId } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [tab, setTab] = useState<Tab>('transactions');

  const vendorQuery = useQuery({
    queryKey: ['vendor', activeBusinessId, id],
    queryFn: () => getVendor(activeBusinessId!, id),
    enabled: !!activeBusinessId,
  });
  // GET /vendors/:id doesn't return open_balance (list-only, computed field)
  // — same pattern as the customer detail screen's fix for the same gap.
  const vendorsListQuery = useQuery({
    queryKey: ['vendors', activeBusinessId],
    queryFn: () => listVendors(activeBusinessId!),
    enabled: !!activeBusinessId,
    staleTime: 5 * 60_000,
  });
  const openBalance = vendorsListQuery.data?.find(v => v.id === id)?.open_balance;
  const transactionsQuery = useQuery({
    queryKey: ['transactions', activeBusinessId, { contact_id: id }],
    queryFn: () => listTransactions(activeBusinessId!, { contact_id: id, limit: 200 }),
    enabled: !!activeBusinessId && tab === 'transactions',
  });
  const notesQuery = useQuery({
    queryKey: ['vendor-notes', activeBusinessId, id],
    queryFn: () => listVendorNotes(activeBusinessId!, id),
    enabled: !!activeBusinessId && tab === 'notes',
  });
  const queryClient = useQueryClient();
  const [newNote, setNewNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  async function submitNote() {
    if (!newNote.trim() || !activeBusinessId) return;
    setAddingNote(true);
    setNoteError(null);
    try {
      await addVendorNote(activeBusinessId, id, newNote.trim());
      setNewNote('');
      await queryClient.invalidateQueries({ queryKey: ['vendor-notes', activeBusinessId, id] });
    } catch (e) {
      setNoteError(pickErr(e));
    } finally {
      setAddingNote(false);
    }
  }

  const loading = vendorQuery.isLoading;
  const vendor = vendorQuery.data;
  const refreshing = vendorQuery.isFetching || vendorsListQuery.isFetching || transactionsQuery.isFetching;
  function refresh() {
    void vendorQuery.refetch();
    void vendorsListQuery.refetch();
    if (tab === 'transactions') void transactionsQuery.refetch();
    if (tab === 'notes') void notesQuery.refetch();
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Appbar.Header statusBarHeight={insets.top} style={{ backgroundColor: theme.app.surface }}>
        <Appbar.BackAction onPress={() => router.back()} color={theme.app.foreground} />
        <Appbar.Content title={vendor?.name ?? 'Vendor'} titleStyle={{ color: theme.app.foreground }} />
      </Appbar.Header>

      {loading ? (
        <LoadingIndicator />
      ) : vendorQuery.error || !vendor ? (
        <ErrorState onRetry={() => void vendorQuery.refetch()} />
      ) : (
        <>
          <View style={styles.amountBlock}>
            <Text style={{ fontSize: typeScale.caption, color: theme.app.mutedForeground }}>Open balance</Text>
            <Text style={{ fontSize: 32, fontWeight: '700', color: theme.app.foreground, marginTop: 2 }}>
              ${fmtMoney(openBalance)}
            </Text>
          </View>

          <View style={{ paddingHorizontal: spacing.md, marginBottom: spacing.sm }}>
            <AppSegmentedControl
              value={tab}
              onChange={setTab}
              options={[
                { value: 'transactions', label: 'Transactions' },
                { value: 'details', label: 'Details' },
                { value: 'notes', label: 'Notes' },
              ]}
            />
          </View>

          {tab === 'details' ? (
            <ScrollView
              contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxl }]}
              refreshControl={<RefreshControl refreshing={!loading && refreshing} onRefresh={refresh} tintColor={theme.app.primary} />}
            >
              <Card style={{ backgroundColor: theme.app.surface }}>
                <Card.Content>
                  {vendor.company_name ? <FieldRow label="Company" value={vendor.company_name} theme={theme} /> : null}
                  {vendor.email ? (
                    <Pressable onPress={() => Linking.openURL(`mailto:${vendor.email}`)}>
                      <FieldRow label="Email" value={vendor.email} theme={theme} link />
                    </Pressable>
                  ) : null}
                  {(vendor.phone ?? vendor.mobile) ? (
                    <Pressable onPress={() => Linking.openURL(`tel:${vendor.phone ?? vendor.mobile}`)}>
                      <FieldRow label="Phone" value={(vendor.phone ?? vendor.mobile) ?? ''} theme={theme} link />
                    </Pressable>
                  ) : null}
                  {vendor.website ? (
                    <Pressable onPress={() => Linking.openURL(vendor.website!)}>
                      <FieldRow label="Website" value={vendor.website} theme={theme} link />
                    </Pressable>
                  ) : null}
                  {vendor.account_number ? <FieldRow label="Account number" value={vendor.account_number} theme={theme} /> : null}
                  <FieldRow label="1099 vendor" value={vendor.is_1099 ? 'Yes' : 'No'} theme={theme} />
                  {vendor.notes ? <FieldRow label="Notes" value={vendor.notes} theme={theme} last /> : null}
                </Card.Content>
              </Card>
            </ScrollView>
          ) : tab === 'transactions' ? (
            transactionsQuery.isLoading ? (
              <LoadingIndicator />
            ) : transactionsQuery.error ? (
              <ErrorState onRetry={() => void transactionsQuery.refetch()} />
            ) : (
            <ScrollView
              contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
              refreshControl={<RefreshControl refreshing={!loading && refreshing} onRefresh={refresh} tintColor={theme.app.primary} />}
            >
              {transactionsQuery.data?.transactions.length === 0 ? (
                <EmptyState icon="swap-horizontal" message="No transactions yet." />
              ) : (
                transactionsQuery.data?.transactions.map((tx: TransactionRow, i) => (
                  <View key={`${tx.type}:${tx.id}`}>
                    <Pressable
                      style={({ pressed }) => [styles.txRow, { opacity: pressed ? 0.6 : 1 }]}
                      onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: tx.id, type: tx.type } })}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.app.foreground, fontWeight: '600' }} numberOfLines={1}>
                          {tx.memo ?? tx.type}
                        </Text>
                        <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>
                          {fmtShortDate(tx.date)}{tx.ref_no ? ` · #${tx.ref_no}` : ''}
                        </Text>
                      </View>
                      <Text style={{ color: theme.app.foreground, fontWeight: '700' }}>${fmtMoney(tx.total_amount)}</Text>
                    </Pressable>
                    {i < (transactionsQuery.data?.transactions.length ?? 0) - 1 && (
                      <View style={[styles.divider, { backgroundColor: theme.app.border }]} />
                    )}
                  </View>
                ))
              )}
            </ScrollView>
            )
          ) : (
            <ScrollView
              contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxl }]}
              refreshControl={<RefreshControl refreshing={!loading && refreshing} onRefresh={refresh} tintColor={theme.app.primary} />}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.addNoteRow}>
                <AppTextInput
                  placeholder="Add a note"
                  value={newNote}
                  onChangeText={setNewNote}
                  multiline
                  containerStyle={{ flex: 1 }}
                />
                <AppButton onPress={() => void submitNote()} loading={addingNote} disabled={!newNote.trim()}>Add</AppButton>
              </View>
              {noteError ? <Text style={{ color: theme.app.destructive, fontSize: typeScale.caption, marginBottom: spacing.sm }}>{noteError}</Text> : null}

              {notesQuery.isLoading ? (
                <LoadingIndicator size="sm" />
              ) : notesQuery.error ? (
                <ErrorState onRetry={() => void notesQuery.refetch()} />
              ) : notesQuery.data?.length === 0 ? (
                <EmptyState icon="note-text-outline" message="No notes yet." compact />
              ) : (
                notesQuery.data?.map(note => (
                  <Card key={note.id} style={{ backgroundColor: theme.app.surface, marginBottom: spacing.sm }}>
                    <Card.Content>
                      <Text style={{ color: theme.app.foreground }}>{note.note_text}</Text>
                      <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption, marginTop: spacing.xs, fontFamily: fontFamily.medium }}>
                        {note.author_name} · {fmtShortDate(note.created_at)}
                      </Text>
                    </Card.Content>
                  </Card>
                ))
              )}
            </ScrollView>
          )}
        </>
      )}
    </View>
  );
}

function FieldRow({ label, value, theme, last, link }: { label: string; value: string; theme: AppTheme; last?: boolean; link?: boolean }) {
  return (
    <View style={[styles.fieldRow, last && { marginBottom: 0 }]}>
      <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>{label}</Text>
      <Text style={{ color: link ? theme.app.primary : theme.app.foreground, fontWeight: '500', marginTop: 1 }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md },
  amountBlock: { alignItems: 'center', marginTop: spacing.sm, marginBottom: spacing.md },
  addNoteRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, marginBottom: spacing.md },
  fieldRow: { marginBottom: spacing.sm },
  txRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: spacing.md },
});
