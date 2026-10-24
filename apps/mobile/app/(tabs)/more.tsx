import { useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuth } from '../../hooks/useAuth';
import { useCanOpen } from '../../lib/roleAccess';
import { AppHeader } from '../../components/AppHeader';
import { AppButton } from '../../components/ui/AppButton';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { fontFamily, spacing, type AppTheme } from '../../theme';

// Second pass at this screen: the first light-theme version (restyled off
// the dropped dark sidebar skin) still read as a settings dump — every nav
// item as an equally-weighted small text row. This version gives the 6
// most-used destinations their own big tap targets up top (QBO mobile's
// shortcut-tile pattern) so the common case needs no expanding at all;
// the accordion below is genuinely "everything else," collapsed by default.
type NavChild = { label: string; path?: string; params?: Record<string, string>; icon?: keyof typeof MaterialCommunityIcons.glyphMap };
type NavGroup = { id: string; label: string; children: NavChild[] };
type Shortcut = { label: string; icon: keyof typeof MaterialCommunityIcons.glyphMap; path: string; params?: Record<string, string> };

// The 6 things accountants reach for most — each one's path mirrors the
// equivalent group item exactly (see the comments below), so pulling it up
// here is a dedicated shortcut, not a second route to the same screen.
const SHORTCUTS: Shortcut[] = [
  { label: 'Invoices', icon: 'file-document-outline', path: '/invoices' },
  { label: 'Expenses', icon: 'cash-minus', path: '/(tabs)/transactions' },
  { label: 'Customers', icon: 'account-group-outline', path: '/clients', params: { tab: 'customers' } },
  { label: 'Vendors', icon: 'domain', path: '/clients', params: { tab: 'vendors' } },
  { label: 'AI Inbox', icon: 'inbox-arrow-down-outline', path: '/inbox' },
  { label: 'Messages', icon: 'message-outline', path: '/messages' },
];

// Same groups as before, minus whatever's now a shortcut tile above
// (Invoices/Customers out of AR, Expense Transactions/Vendors out of AP,
// Document Inbox out of AI, Messages dropped as a loose top-level row) —
// nothing here is a second path to a screen already one tap away.
const NAV_GROUPS: NavGroup[] = [
  {
    id: 'ar', label: 'Accounts Receivable',
    children: [
      { label: 'Estimates', path: '/estimates', icon: 'file-document-edit-outline' },
      { label: 'Payments', path: '/payments', icon: 'cash-check' },
      { label: 'Credit Memos', path: '/credit-memos', icon: 'file-document-minus-outline' },
      { label: 'Aging', path: '/ar-aging', icon: 'calendar-clock-outline' },
      { label: 'Statements', path: '/customer-statement', icon: 'file-account-outline' },
    ],
  },
  {
    id: 'ap', label: 'Accounts Payable',
    children: [
      { label: 'Overview', path: '/ap-overview', icon: 'view-dashboard-outline' },
      { label: 'Checks', path: '/checks', icon: 'checkbook' },
      { label: 'Bills', path: '/bills', icon: 'file-document-outline' },
      { label: 'Pay Bills', path: '/bill-payment/new', icon: 'cash-multiple' },
      { label: 'Bill Payments', path: '/bill-payments', icon: 'cash-fast' },
      { label: 'Vendor Credits', path: '/vendor-credits', icon: 'file-document-minus-outline' },
      { label: 'Contractors', path: '/contractors', icon: 'account-hard-hat-outline' },
      { label: 'Aging', path: '/ap-aging', icon: 'calendar-clock-outline' },
      { label: '1099s', path: '/1099s', icon: 'file-document-outline' },
    ],
  },
  {
    id: 'ai', label: 'AI',
    children: [
      { label: 'Coding Rules', path: '/coding-rules', icon: 'creation' },
      { label: 'Suspense', path: '/suspense', icon: 'help-circle-outline' },
    ],
  },
  {
    id: 'accounting', label: 'Accounting',
    children: [
      { label: 'Client Overview', icon: 'view-grid-outline' }, { label: 'Books Review', path: '/books-review', icon: 'clipboard-check-outline' }, { label: 'Approvals', path: '/approvals', icon: 'check-decagram-outline' },
      { label: 'Bank Accounts', path: '/bank-accounts', icon: 'bank-outline' }, { label: 'Bank Transactions', path: '/bank-transactions', icon: 'bank-outline' }, { label: 'Integration Transactions', path: '/integration-transactions', icon: 'swap-horizontal' },
      { label: 'Receipts', path: '/receipts', icon: 'receipt' }, { label: 'Reconcile', path: '/reconcile', icon: 'bank-check' }, { label: 'Rules', path: '/bank-rules', icon: 'filter-variant' }, { label: 'Chart of Accounts', path: '/chart-of-accounts', icon: 'book-open-variant' },
      { label: 'Recurring Transactions', path: '/recurring-templates', icon: 'autorenew' }, { label: 'Fixed Assets', path: '/fixed-assets', icon: 'office-building-outline' }, { label: 'Journal', path: '/journal-entries', icon: 'book-open-page-variant-outline' },
    ],
  },
  {
    id: 'reports', label: 'Reports',
    children: [
      { label: 'Standard Reports', path: '/standard-reports', icon: 'view-list-outline' },
      { label: 'Profit & Loss', path: '/pnl', icon: 'chart-line' },
      { label: 'Balance Sheet', path: '/balance-sheet', icon: 'scale-balance' },
      { label: 'General Ledger', path: '/general-ledger', icon: 'format-list-numbered' },
      { label: 'Cash Flows', path: '/cash-flow', icon: 'cash-sync' }, { label: 'Cash Activity', path: '/cash-activity', icon: 'bank-transfer' }, { label: 'Custom Reports', path: '/custom-reports', icon: 'file-chart-outline' },
      { label: 'Management Reports', path: '/management-reports', icon: 'finance' }, { label: 'Performance Center', path: '/performance-center', icon: 'trending-up' }, { label: 'Financial Planning', path: '/financial-planning', icon: 'chart-box-outline' },
      { label: 'Spreadsheet Sync', path: '/spreadsheet-sync', icon: 'file-export-outline' }, { label: 'Trial Balance', path: '/trial-balance', icon: 'table-check' },
    ],
  },
  {
    id: 'inventory', label: 'Inventory',
    children: [
      { label: 'Overview', path: '/inventory-overview', icon: 'view-dashboard-outline' }, { label: 'Inventory', path: '/inventory-items', icon: 'package-variant-closed' }, { label: 'Purchase Orders', path: '/purchase-orders', icon: 'clipboard-list-outline' },
      { label: 'Item Receipts', path: '/item-receipts', icon: 'package-down' }, { label: 'Sales Orders', path: '/sales-orders', icon: 'cart-outline' }, { label: 'Shipping Labels', path: '/shipping-labels', icon: 'truck-outline' },
    ],
  },
  {
    id: 'setup', label: 'Setup',
    children: [
      { label: 'Entity', path: '/entity', icon: 'domain' }, { label: 'Company Settings', path: '/company-settings', icon: 'cog-outline' }, { label: 'Chart of Accounts', path: '/chart-of-accounts', icon: 'book-open-variant' },
      { label: 'Cost Centers', path: '/cost-centers', icon: 'tag-outline' }, { label: 'Users', path: '/users', icon: 'account-group-outline' }, { label: 'Activity Log', path: '/activity-log', icon: 'history' },
      { label: 'Tax Codes', path: '/tax-codes', icon: 'percent-outline' }, { label: 'Fiscal Periods', path: '/fiscal-periods', icon: 'calendar-blank-outline' },
    ],
  },
];

function formatRole(role: string): string {
  return role.split('_').map(w => w[0]!.toUpperCase() + w.slice(1)).join(' ');
}

function go(target: { path?: string; params?: Record<string, string> }) {
  if (!target.path) return;
  router.push({ pathname: target.path as never, params: target.params } as never);
}

export default function MoreScreen() {
  const theme = useTheme<AppTheme>();
  const c = theme.app;
  const { user } = useAuth();
  const canOpen = useCanOpen();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const visibleShortcuts = SHORTCUTS.filter(s => canOpen(s.path));

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="More" />

      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }}>
        {user ? (
          <View style={[styles.userStrip, { backgroundColor: c.surface }]}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                <Text style={{ color: c.foreground, fontFamily: fontFamily.semibold, fontSize: 14 }} numberOfLines={1}>
                  {user.full_name}
                </Text>
                <StatusBadge status="blue" label={formatRole(user.role)} />
              </View>
              <Text style={{ color: c.mutedForeground, fontSize: 11, marginTop: 2 }} numberOfLines={1}>
                {user.email}
              </Text>
            </View>
          </View>
        ) : null}

        {canOpen('/expense/new') ? (
          <View style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
            <AppButton onPress={() => router.push('/(tabs)/create')} fullWidth>+ Create</AppButton>
          </View>
        ) : null}

        <View style={styles.grid}>
          {visibleShortcuts.map(s => (
            <Pressable
              key={s.label}
              onPress={() => go(s)}
              style={({ pressed }) => [
                styles.tile,
                { backgroundColor: pressed ? c.muted : c.surface, borderColor: c.border },
              ]}
            >
              <MaterialCommunityIcons name={s.icon} size={24} color={c.primary} />
              <Text style={{ color: c.foreground, fontFamily: fontFamily.medium, fontSize: 13, marginTop: 6 }} numberOfLines={1}>
                {s.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {NAV_GROUPS.map(group => {
          const visibleChildren = group.children.filter(child => !child.path || canOpen(child.path));
          if (visibleChildren.length === 0) return null;
          const isExpanded = expanded.has(group.id);

          return (
            <View key={group.id}>
              <Pressable
                style={styles.sectionHeader}
                onPress={() => setExpanded(prev => {
                  const next = new Set(prev);
                  if (next.has(group.id)) next.delete(group.id); else next.add(group.id);
                  return next;
                })}
              >
                <Text style={{ flex: 1, color: c.foreground, fontFamily: fontFamily.medium, fontSize: 15 }}>
                  {group.label}
                </Text>
                <MaterialCommunityIcons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={20} color={c.mutedForeground} />
              </Pressable>

              {isExpanded && visibleChildren.map(child => (
                <MenuItemRow key={child.label} label={child.label} icon={child.icon} disabled={!child.path} onPress={() => go(child)} theme={theme} />
              ))}
            </View>
          );
        })}

        <View style={{ marginTop: spacing.md }}>
          <MenuItemRow label="Send documents" icon="upload-outline" onPress={() => router.push('/send-documents')} theme={theme} />
          <MenuItemRow label="Settings" icon="cog-outline" onPress={() => router.push('/settings')} theme={theme} />
        </View>
      </ScrollView>
    </View>
  );
}

function MenuItemRow({
  label, icon, disabled, onPress, theme,
}: { label: string; icon?: keyof typeof MaterialCommunityIcons.glyphMap; disabled?: boolean; onPress: () => void; theme: AppTheme }) {
  const c = theme.app;
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.itemRow,
        { backgroundColor: pressed ? c.muted : c.surface, borderBottomColor: c.border },
      ]}
    >
      <MaterialCommunityIcons name={icon ?? 'circle-small'} size={20} color={disabled ? c.border : c.mutedForeground} />
      <Text style={[styles.itemLabel, { color: disabled ? c.mutedForeground : c.foreground }]} numberOfLines={1}>
        {label}
      </Text>
      {disabled ? (
        <Text style={{ color: c.mutedForeground, fontSize: 11 }}>Desktop only</Text>
      ) : (
        <MaterialCommunityIcons name="chevron-right" size={18} color={c.mutedForeground} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  userStrip: { paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  grid: {
    flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: spacing.md, gap: 8, marginBottom: spacing.sm,
  },
  tile: {
    width: '47%', height: 80, borderWidth: 1, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', height: 56, paddingHorizontal: spacing.md,
  },
  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    height: 52, paddingLeft: spacing.md + 32, paddingRight: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  itemLabel: { flex: 1, fontFamily: fontFamily.regular, fontSize: 15 },
});
