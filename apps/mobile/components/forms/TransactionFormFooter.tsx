import { useState } from 'react';
import { View, StyleSheet, Pressable, Alert } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { hasMinRole, type Role } from '@accounting/shared';
import { useAuth } from '../../hooks/useAuth';
import { AppButton } from '../ui/AppButton';
import { AppMenu, AppMenuItem } from '../ui/AppMenu';
import { fontFamily, typeScale, spacing, type AppTheme } from '../../theme';

/**
 * Same bottom bar as web's Expense/Deposit editors (ExpensePage.tsx):
 * Cancel · Make recurring · More · Save — not stripped down just because
 * this is mobile. "More" (existing records only) holds Copy, Void,
 * Transaction journal, Delete, gated by the same roles the API enforces
 * (accountant for void, firm_admin for delete) so a staff login doesn't
 * see options the server would refuse anyway.
 */
export function TransactionFormFooter({
  existingId, journalEntryId, saving, saveLabel, onSave, onCopy, onVoid, onDelete,
}: {
  existingId?: string;
  journalEntryId?: string | null;
  saving: boolean;
  saveLabel: string;
  onSave: () => void;
  onCopy?: () => void;
  onVoid?: () => void;
  onDelete?: () => void;
}) {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { businesses, activeBusinessId, user } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);

  const effectiveRole = (businesses.find(b => b.id === activeBusinessId)?.role_override ?? user?.role ?? 'viewer') as Role;
  const canVoid = hasMinRole(effectiveRole, 'accountant');
  const canDelete = hasMinRole(effectiveRole, 'firm_admin');

  function makeRecurring() {
    Alert.alert('Make recurring', "Recurring transactions aren't available on mobile yet — use the web app.");
  }

  return (
    <View style={[styles.bar, { borderTopColor: theme.app.border, backgroundColor: theme.app.surface, paddingBottom: insets.bottom + spacing.sm }]}>
      <AppButton variant="outline" onPress={() => router.back()}>Cancel</AppButton>

      <View style={styles.center}>
        <Pressable onPress={makeRecurring}>
          <Text style={{ color: theme.app.link, fontFamily: fontFamily.medium, fontSize: typeScale.caption }}>Make recurring</Text>
        </Pressable>

        {existingId ? (
          <>
            <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }}>·</Text>
            <AppMenu
              visible={moreOpen}
              onDismiss={() => setMoreOpen(false)}
              anchor={
                <Pressable onPress={() => setMoreOpen(true)}>
                  <Text style={{ color: theme.app.link, fontFamily: fontFamily.medium, fontSize: typeScale.caption }}>More</Text>
                </Pressable>
              }
            >
              {onCopy ? <AppMenuItem leadingIcon="content-copy" title="Copy" onPress={() => { setMoreOpen(false); onCopy(); }} /> : null}
              {onVoid && canVoid ? <AppMenuItem leadingIcon="close-circle-outline" title="Void" onPress={() => { setMoreOpen(false); onVoid(); }} /> : null}
              <AppMenuItem
                leadingIcon="book-open-outline"
                title="Transaction journal"
                disabled={!journalEntryId}
                onPress={() => {
                  setMoreOpen(false);
                  if (journalEntryId) router.push({ pathname: '/transaction/[id]', params: { id: journalEntryId, type: 'journal' } });
                }}
              />
              {onDelete && canDelete ? (
                <AppMenuItem leadingIcon="trash-can-outline" title="Delete" destructive onPress={() => { setMoreOpen(false); onDelete(); }} />
              ) : null}
            </AppMenu>
          </>
        ) : null}
      </View>

      <AppButton onPress={onSave} loading={saving} style={styles.saveButton}>{saveLabel}</AppButton>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm,
  },
  center: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  saveButton: { minWidth: 100 },
});
