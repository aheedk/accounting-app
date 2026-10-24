import { useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Text, Divider, useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuth } from '../../hooks/useAuth';
import { useCanOpen } from '../../lib/roleAccess';
import { AppHeader } from '../../components/AppHeader';
import { fontFamily, typeScale, spacing, minTouchTarget, type AppTheme } from '../../theme';

// This screen used to be its own hand-maintained flat list, separate from
// (and drifted from) the nav drawer's own grouping — two lists to keep in
// sync, and they'd already fallen out of step (missing items, no role
// filtering, no "Desktop only" treatment here). The drawer is gone now (per
// request: no more hamburger/slide-out panel) and this tab is its
// replacement, so it renders the drawer's own former structure directly —
// same groups, icons, ordering, role filtering, and "Desktop only" disabled
// treatment as the structural port of web's Sidebar.tsx ALL_GROUPS — just
// as a static page instead of a sliding overlay. Dashboard/Transactions are
// left out here since the bottom tab bar already covers them; Create has
// its own tab too, so only its button survives, not a duplicate list entry.
type NavChild = { label: string; path?: string; params?: Record<string, string> };
type NavGroup = { id: string; label: string; icon: keyof typeof MaterialCommunityIcons.glyphMap; path?: string; children?: NavChild[] };

const NAV_GROUPS: NavGroup[] = [
  { id: 'messages', label: 'Messages', icon: 'message-outline', path: '/messages' },
  { id: 'send-documents', label: 'Send documents', icon: 'upload-outline', path: '/send-documents' },
  {
    id: 'ar', label: 'Accounts Receivable', icon: 'account-group-outline',
    children: [
      { label: 'Customers', path: '/clients', params: { tab: 'customers' } },
      { label: 'Invoices', path: '/invoices' },
      { label: 'Estimates', path: '/estimates' },
      { label: 'Payments', path: '/payments' },
      { label: 'Credit Memos', path: '/credit-memos' },
      { label: 'Aging', path: '/ar-aging' },
      { label: 'Statements', path: '/customer-statement' },
    ],
  },
  {
    id: 'ap', label: 'Accounts Payable', icon: 'wallet-outline',
    children: [
      { label: 'Overview', path: '/ap-overview' },
      { label: 'Expense Transactions', path: '/(tabs)/transactions' },
      { label: 'Checks', path: '/checks' },
      { label: 'Vendors', path: '/clients', params: { tab: 'vendors' } },
      { label: 'Bills', path: '/bills' },
      { label: 'Pay Bills', path: '/bill-payment/new' },
      { label: 'Bill Payments', path: '/bill-payments' },
      { label: 'Vendor Credits', path: '/vendor-credits' },
      { label: 'Contractors', path: '/contractors' },
      { label: 'Aging', path: '/ap-aging' },
      { label: '1099s', path: '/1099s' },
    ],
  },
  {
    id: 'ai', label: 'AI', icon: 'creation',
    children: [
      { label: 'Document Inbox', path: '/inbox' },
      { label: 'Coding Rules', path: '/coding-rules' },
      { label: 'Suspense', path: '/suspense' },
    ],
  },
  {
    id: 'accounting', label: 'Accounting', icon: 'book-open-outline',
    children: [
      { label: 'Client Overview' }, { label: 'Books Review', path: '/books-review' }, { label: 'Approvals', path: '/approvals' },
      { label: 'Bank Accounts', path: '/bank-accounts' }, { label: 'Bank Transactions', path: '/bank-transactions' }, { label: 'Integration Transactions', path: '/integration-transactions' },
      { label: 'Receipts', path: '/receipts' }, { label: 'Reconcile', path: '/reconcile' }, { label: 'Rules', path: '/bank-rules' }, { label: 'Chart of Accounts', path: '/chart-of-accounts' },
      { label: 'Recurring Transactions', path: '/recurring-templates' }, { label: 'Fixed Assets', path: '/fixed-assets' }, { label: 'Journal', path: '/journal-entries' },
    ],
  },
  {
    id: 'reports', label: 'Reports', icon: 'chart-bar',
    children: [
      { label: 'Standard Reports', path: '/standard-reports' },
      { label: 'Profit & Loss', path: '/pnl' },
      { label: 'Balance Sheet', path: '/balance-sheet' },
      { label: 'General Ledger', path: '/general-ledger' },
      { label: 'Cash Flows', path: '/cash-flow' }, { label: 'Cash Activity', path: '/cash-activity' }, { label: 'Custom Reports', path: '/custom-reports' },
      { label: 'Management Reports', path: '/management-reports' }, { label: 'Performance Center', path: '/performance-center' }, { label: 'Financial Planning', path: '/financial-planning' },
      { label: 'Spreadsheet Sync', path: '/spreadsheet-sync' }, { label: 'Trial Balance', path: '/trial-balance' },
    ],
  },
  {
    id: 'inventory', label: 'Inventory', icon: 'package-variant-closed',
    children: [
      { label: 'Overview', path: '/inventory-overview' }, { label: 'Inventory', path: '/inventory-items' }, { label: 'Purchase Orders', path: '/purchase-orders' },
      { label: 'Item Receipts', path: '/item-receipts' }, { label: 'Sales Orders', path: '/sales-orders' }, { label: 'Shipping Labels', path: '/shipping-labels' },
    ],
  },
  {
    id: 'setup', label: 'Setup', icon: 'cog-outline',
    children: [
      { label: 'Entity', path: '/entity' }, { label: 'Company Settings', path: '/company-settings' }, { label: 'Chart of Accounts', path: '/chart-of-accounts' },
      { label: 'Cost Centers', path: '/cost-centers' }, { label: 'Users', path: '/users' }, { label: 'Activity Log', path: '/activity-log' },
      { label: 'Tax Codes', path: '/tax-codes' }, { label: 'Fiscal Periods', path: '/fiscal-periods' },
    ],
  },
];

export default function MoreScreen() {
  const theme = useTheme<AppTheme>();
  const c = theme.app;
  const { user } = useAuth();
  const canOpen = useCanOpen();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function go(child: NavChild | NavGroup) {
    if (!child.path) return;
    router.push({ pathname: child.path as never, params: 'params' in child ? child.params : undefined } as never);
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="More" />

      <ScrollView style={{ backgroundColor: c.sidebar }} contentContainerStyle={{ paddingBottom: spacing.xxl }}>
        {user ? (
          <View style={styles.userRow}>
            <Text style={{ color: c.sidebarForeground, fontFamily: fontFamily.semibold }}>{user.full_name}</Text>
            <Text style={{ color: c.sidebarMuted, marginTop: 2, fontSize: typeScale.caption }}>{user.email}</Text>
          </View>
        ) : null}

        {canOpen('/expense/new') && (
          <Pressable style={[styles.createButton, { backgroundColor: c.gold }]} onPress={() => router.push('/(tabs)/create')}>
            <MaterialCommunityIcons name="plus" size={18} color={c.sidebar} />
            <Text style={{ color: c.sidebar, fontFamily: fontFamily.semibold, fontSize: typeScale.body }}>Create</Text>
          </Pressable>
        )}

        <Divider style={{ backgroundColor: 'rgba(255,255,255,0.1)', marginTop: spacing.md }} />

        {NAV_GROUPS.map(group => {
          // A role that can't open this path doesn't see it at all — same as
          // web's Sidebar.tsx, which drops role-denied items rather than
          // showing them disabled (that treatment is reserved for features
          // this app hasn't built yet, a different kind of gap).
          if (group.path && !canOpen(group.path)) return null;
          if (!group.children) {
            const disabled = !group.path;
            return (
              <Pressable
                key={group.id}
                disabled={disabled}
                onPress={() => go(group)}
                style={[styles.row, disabled && styles.rowDisabled]}
              >
                <MaterialCommunityIcons name={group.icon} size={20} color={disabled ? '#5a6382' : c.sidebarForeground} />
                <Text style={[styles.rowText, { color: c.sidebarForeground }, disabled && styles.rowTextDisabled]}>{group.label}</Text>
                {disabled ? <Text style={styles.availableNote}>Desktop only</Text> : null}
              </Pressable>
            );
          }
          const visibleChildren = group.children.filter(child => !child.path || canOpen(child.path));
          if (visibleChildren.length === 0) return null;
          const isExpanded = expanded.has(group.id);
          return (
            <View key={group.id}>
              <Pressable
                style={styles.row}
                onPress={() => setExpanded(prev => {
                  const next = new Set(prev);
                  if (next.has(group.id)) next.delete(group.id); else next.add(group.id);
                  return next;
                })}
              >
                <MaterialCommunityIcons name={group.icon} size={20} color={c.sidebarForeground} />
                <Text style={[styles.rowText, { color: c.sidebarForeground }]}>{group.label}</Text>
                <MaterialCommunityIcons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={c.sidebarMuted} />
              </Pressable>
              {isExpanded && visibleChildren.map(child => {
                const disabled = !child.path;
                return (
                  <Pressable
                    key={child.label}
                    disabled={disabled}
                    onPress={() => go(child)}
                    style={[styles.childRow, disabled && styles.rowDisabled]}
                  >
                    <Text style={[styles.childRowText, { color: c.sidebarMuted }, disabled && styles.rowTextDisabled]} numberOfLines={1}>{child.label}</Text>
                    {disabled ? <Text style={styles.availableNote}>Desktop only</Text> : null}
                  </Pressable>
                );
              })}
            </View>
          );
        })}

        <Divider style={{ backgroundColor: 'rgba(255,255,255,0.1)', marginBottom: spacing.sm }} />

        <Pressable style={styles.row} onPress={() => router.push('/settings')}>
          <MaterialCommunityIcons name="cog-outline" size={20} color={c.sidebarForeground} />
          <Text style={[styles.rowText, { color: c.sidebarForeground }]}>Settings</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  userRow: { paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  createButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginHorizontal: spacing.md, marginTop: spacing.sm, minHeight: 40, borderRadius: 6,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: minTouchTarget, paddingHorizontal: spacing.md },
  rowDisabled: { opacity: 0.55 },
  rowText: { flex: 1, fontFamily: fontFamily.medium, fontSize: typeScale.body },
  childRow: { minHeight: minTouchTarget - 8, paddingLeft: spacing.md + 32, paddingRight: spacing.md, flexDirection: 'row', alignItems: 'center' },
  childRowText: { flex: 1, fontFamily: fontFamily.regular, fontSize: typeScale.body },
  rowTextDisabled: { color: '#5a6382' },
  availableNote: { color: '#5a6382', fontFamily: fontFamily.regular, fontSize: typeScale.caption },
});
