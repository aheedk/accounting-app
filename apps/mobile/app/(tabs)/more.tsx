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
import { fontFamily, typeScale, spacing, type AppTheme } from '../../theme';

// QBO's own mobile app drops the desktop dark sidebar skin entirely for its
// Menu tab — a plain light-themed page of grouped shortcuts, not a ported
// sidebar. This screen follows that: no dark-navy panel, no slide animation
// (there's nothing to slide any more — this tab IS the destination). Same
// groups/items/ordering/role-filtering as before, restyled as a native
// "More menu" list. Dashboard/Transactions stay off this list since the
// bottom tab bar already covers them; Create keeps its own button instead
// of a duplicate row.
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

function formatRole(role: string): string {
  return role.split('_').map(w => w[0]!.toUpperCase() + w.slice(1)).join(' ');
}

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

      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }}>
        {user ? (
          <View style={[styles.userStrip, { backgroundColor: c.surface }]}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                <Text style={{ color: c.foreground, fontFamily: fontFamily.semibold, fontSize: typeScale.body }} numberOfLines={1}>
                  {user.full_name}
                </Text>
                <StatusBadge status="blue" label={formatRole(user.role)} />
              </View>
              <Text style={{ color: c.mutedForeground, fontSize: typeScale.caption, marginTop: 2 }} numberOfLines={1}>
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

        {NAV_GROUPS.map(group => {
          // A role that can't open this path doesn't see it at all — same as
          // web's Sidebar.tsx, which drops role-denied items rather than
          // showing them disabled (that treatment is reserved for features
          // this app hasn't built yet, a different kind of gap).
          if (group.path && !canOpen(group.path)) return null;

          if (!group.children) {
            return <MenuItemRow key={group.id} label={group.label} icon={group.icon} onPress={() => go(group)} theme={theme} />;
          }

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
                <Text style={{ flex: 1, color: c.mutedForeground, fontSize: typeScale.caption, fontFamily: fontFamily.semibold, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {group.label}
                </Text>
                <MaterialCommunityIcons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={c.mutedForeground} />
              </Pressable>

              {isExpanded && visibleChildren.map(child => {
                const disabled = !child.path;
                return (
                  <MenuItemRow
                    key={child.label}
                    label={child.label}
                    disabled={disabled}
                    onPress={() => go(child)}
                    theme={theme}
                  />
                );
              })}
            </View>
          );
        })}

        <View style={{ marginTop: spacing.md }}>
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
      {icon ? <MaterialCommunityIcons name={icon} size={20} color={disabled ? c.border : c.mutedForeground} /> : null}
      <Text
        style={[
          styles.itemLabel,
          { color: disabled ? c.mutedForeground : c.foreground, marginLeft: icon ? 0 : spacing.md + 20 + spacing.sm },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {disabled ? (
        <Text style={{ color: c.mutedForeground, fontSize: typeScale.caption }}>Desktop only</Text>
      ) : (
        <MaterialCommunityIcons name="chevron-right" size={18} color={c.mutedForeground} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  userStrip: { paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md,
    paddingTop: spacing.sm, paddingBottom: spacing.xs, marginTop: spacing.xs,
  },
  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    height: 48, paddingHorizontal: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  itemLabel: { flex: 1, fontFamily: fontFamily.regular, fontSize: typeScale.body },
});
