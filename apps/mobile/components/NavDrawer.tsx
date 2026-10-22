import { useEffect, useState } from 'react';
import { View, StyleSheet, Pressable, ScrollView, Dimensions } from 'react-native';
import { Text, Divider } from 'react-native-paper';
import { AppMenu, AppMenuItem } from './ui/AppMenu';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../hooks/useAuth';
import { useNavDrawer } from '../hooks/useNavDrawer';
import { useCanOpen } from '../lib/roleAccess';
import { lightColors, fontFamily, typeScale, spacing, minTouchTarget } from '../theme';

// Direct structural port of apps/web/src/components/layout/Sidebar.tsx's
// ALL_GROUPS — same grouping, icons, and ordering, so the drawer reads as
// the same product's navigation, not a reinvented mobile menu. `path` is
// this item's real mobile route; omitted means the page exists on web but
// not in this app yet — rendered disabled with "Available on desktop"
// rather than left out (explicit instruction: never just hide a feature).
type NavChild = { label: string; path?: string; params?: Record<string, string> };
type NavGroup = { id: string; label: string; icon: keyof typeof MaterialCommunityIcons.glyphMap; path?: string; children?: NavChild[] };

const NAV_GROUPS: NavGroup[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'view-dashboard-outline', path: '/(tabs)' },
  { id: 'messages', label: 'Messages', icon: 'message-outline' },
  { id: 'send-documents', label: 'Send documents', icon: 'upload-outline' },
  { id: 'transactions', label: 'Transactions', icon: 'format-list-checks', path: '/(tabs)/transactions' },
  {
    id: 'ar', label: 'Accounts Receivable', icon: 'account-group-outline',
    children: [
      { label: 'Customers', path: '/clients', params: { tab: 'customers' } },
      { label: 'Invoices', path: '/invoices' },
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
      { label: 'Cash Flows', path: '/cash-flow' }, { label: 'Cash Activity', path: '/cash-activity' }, { label: 'Custom Reports' },
      { label: 'Management Reports', path: '/management-reports' }, { label: 'Performance Center', path: '/performance-center' }, { label: 'Financial Planning' },
      { label: 'Spreadsheet Sync' }, { label: 'Trial Balance', path: '/trial-balance' },
    ],
  },
  {
    id: 'inventory', label: 'Inventory', icon: 'package-variant-closed',
    children: [
      { label: 'Overview' }, { label: 'Inventory' }, { label: 'Purchase Orders' },
      { label: 'Item Receipts' }, { label: 'Sales Orders' }, { label: 'Shipping Labels' },
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

const DRAWER_WIDTH = Math.min(320, Dimensions.get('window').width * 0.84);

export function NavDrawer() {
  const { isOpen, close } = useNavDrawer();
  const insets = useSafeAreaInsets();
  const { businesses, activeBusinessId, setActiveBusinessId } = useAuth();
  const canOpen = useCanOpen();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const translateX = useSharedValue(-DRAWER_WIDTH);
  const backdropOpacity = useSharedValue(0);

  useEffect(() => {
    translateX.value = withTiming(isOpen ? 0 : -DRAWER_WIDTH, { duration: 220, easing: Easing.out(Easing.cubic) });
    backdropOpacity.value = withTiming(isOpen ? 1 : 0, { duration: 220 });
  }, [isOpen, translateX, backdropOpacity]);

  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdropOpacity.value }));

  const activeBusiness = businesses.find(b => b.id === activeBusinessId);

  function go(child: NavChild | NavGroup) {
    if (!child.path) return;
    close();
    router.push({ pathname: child.path as never, params: 'params' in child ? child.params : undefined } as never);
  }

  return (
    <>
      <Animated.View pointerEvents={isOpen ? 'auto' : 'none'} style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
      </Animated.View>

      <Animated.View style={[styles.panel, { width: DRAWER_WIDTH, paddingTop: insets.top, paddingBottom: insets.bottom }, panelStyle]}>
        <View style={styles.brand}>
          <View style={styles.logoMark}>
            <MaterialCommunityIcons name="book-open-outline" size={18} color={lightColors.sidebar} />
          </View>
          <Text style={{ color: '#fff', fontFamily: fontFamily.display, fontSize: 17 }}>Accounting</Text>
        </View>

        <AppMenu
          visible={switcherOpen}
          onDismiss={() => setSwitcherOpen(false)}
          anchor={
            <Pressable onPress={() => setSwitcherOpen(true)} style={styles.switcherRow}>
              <MaterialCommunityIcons name="domain" size={18} color={lightColors.sidebarMuted} />
              <Text style={styles.switcherText} numberOfLines={1}>{activeBusiness?.name ?? 'Pick a business'}</Text>
              <MaterialCommunityIcons name="chevron-down" size={18} color={lightColors.sidebarMuted} />
            </Pressable>
          }
        >
          {businesses.map(b => (
            <AppMenuItem key={b.id} title={b.name} onPress={() => { setActiveBusinessId(b.id); setSwitcherOpen(false); }} trailingIcon={b.id === activeBusinessId ? 'check' : undefined} />
          ))}
        </AppMenu>

        {canOpen('/expense/new') && (
          <Pressable style={styles.createButton} onPress={() => { close(); router.push('/(tabs)/create'); }}>
            <MaterialCommunityIcons name="plus" size={18} color={lightColors.sidebar} />
            <Text style={styles.createButtonText}>Create</Text>
          </Pressable>
        )}

        <Divider style={styles.divider} />

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: spacing.lg }}>
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
                  <MaterialCommunityIcons name={group.icon} size={20} color={disabled ? '#5a6382' : lightColors.sidebarForeground} />
                  <Text style={[styles.rowText, disabled && styles.rowTextDisabled]}>{group.label}</Text>
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
                  <MaterialCommunityIcons name={group.icon} size={20} color={lightColors.sidebarForeground} />
                  <Text style={styles.rowText}>{group.label}</Text>
                  <MaterialCommunityIcons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={lightColors.sidebarMuted} />
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
                      <Text style={[styles.childRowText, disabled && styles.rowTextDisabled]} numberOfLines={1}>{child.label}</Text>
                      {disabled ? <Text style={styles.availableNote}>Desktop only</Text> : null}
                    </Pressable>
                  );
                })}
              </View>
            );
          })}
        </ScrollView>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(16,20,31,0.5)', zIndex: 40 },
  panel: {
    position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: lightColors.sidebar,
    zIndex: 41, elevation: 8,
  },
  brand: {
    flexDirection: 'row', alignItems: 'center', gap: 10, height: 56,
    paddingHorizontal: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  logoMark: { width: 30, height: 30, borderRadius: 6, backgroundColor: lightColors.gold, alignItems: 'center', justifyContent: 'center' },
  switcherRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: spacing.md,
    minHeight: minTouchTarget, marginTop: spacing.sm,
  },
  switcherText: { flex: 1, color: '#fff', fontFamily: fontFamily.semibold, fontSize: typeScale.body },
  createButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: lightColors.gold, marginHorizontal: spacing.md, marginTop: spacing.sm,
    minHeight: 40, borderRadius: 6,
  },
  createButtonText: { color: lightColors.sidebar, fontFamily: fontFamily.semibold, fontSize: typeScale.body },
  divider: { backgroundColor: 'rgba(255,255,255,0.1)', marginTop: spacing.md },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
  },
  rowDisabled: { opacity: 0.55 },
  rowText: { flex: 1, color: lightColors.sidebarForeground, fontFamily: fontFamily.medium, fontSize: typeScale.body },
  childRow: { minHeight: minTouchTarget - 8, paddingLeft: spacing.md + 32, paddingRight: spacing.md, flexDirection: 'row', alignItems: 'center' },
  childRowText: { flex: 1, color: lightColors.sidebarMuted, fontFamily: fontFamily.regular, fontSize: typeScale.body },
  rowTextDisabled: { color: '#5a6382' },
  availableNote: { color: '#5a6382', fontFamily: fontFamily.regular, fontSize: typeScale.caption },
});
