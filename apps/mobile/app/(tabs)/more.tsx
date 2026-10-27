import { useMemo, useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet, LayoutAnimation, Platform, UIManager } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCanOpen } from '../../lib/roleAccess';
import { AppHeader } from '../../components/AppHeader';
import { AppTextInput } from '../../components/ui/AppTextInput';
import { fontFamily, spacing, type AppTheme } from '../../theme';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Fourth pass at this screen, this time against real QBO Menu-tab
// screenshots: a search bar, a horizontal "Frequently used" shortcut row,
// and 2-column category tiles that expand inline — not another flat list.
// The old user-info strip moved to Settings (it already had a fuller
// ACCOUNT section with the same name/email/role, so nothing new there),
// and the "+ Create" button is gone — CreateFab now floats above all 3
// tabs instead of living on this one screen.
type NavItem = { label: string; path?: string; params?: Record<string, string>; icon?: keyof typeof MaterialCommunityIcons.glyphMap };
type Category = { id: string; label: string; icon: keyof typeof MaterialCommunityIcons.glyphMap; children: NavItem[] };

// Each shortcut's route is the exact same path its old accordion entry used
// — a dedicated shortcut, not a second screen.
const SHORTCUTS: NavItem[] = [
  { label: 'Invoices', path: '/invoices', icon: 'file-document-outline' },
  { label: 'Expenses', path: '/(tabs)/transactions', icon: 'cash-minus' },
  { label: 'Estimates', path: '/estimates', icon: 'file-document-edit-outline' },
  { label: 'Customers', path: '/clients', params: { tab: 'customers' }, icon: 'account-group-outline' },
  { label: 'Vendors', path: '/clients', params: { tab: 'vendors' }, icon: 'domain' },
  { label: 'AI Inbox', path: '/inbox', icon: 'inbox-arrow-down-outline' },
  { label: 'Messages', path: '/messages', icon: 'message-outline' },
  { label: 'Receipts', path: '/receipts', icon: 'receipt' },
];

// Same items as the old accordion groups, minus whatever's now a shortcut
// above (Invoices/Customers/Estimates out of AR, Expenses(as Expense
// Transactions)/Vendors out of AP, AI Inbox out of AI, Receipts out of
// Accounting) — nothing here is a second path to a screen one tap away.
const CATEGORIES: Category[] = [
  {
    id: 'ar', label: 'Accounts Receivable', icon: 'account-group-outline',
    children: [
      { label: 'Payments', path: '/payments', icon: 'cash-check' },
      { label: 'Credit Memos', path: '/credit-memos', icon: 'file-document-minus-outline' },
      { label: 'Aging', path: '/ar-aging', icon: 'calendar-clock-outline' },
      { label: 'Statements', path: '/customer-statement', icon: 'file-account-outline' },
    ],
  },
  {
    id: 'ap', label: 'Accounts Payable', icon: 'file-document-outline',
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
    id: 'ai', label: 'AI', icon: 'creation',
    children: [
      { label: 'Coding Rules', path: '/coding-rules', icon: 'creation' },
      { label: 'Suspense', path: '/suspense', icon: 'help-circle-outline' },
    ],
  },
  {
    id: 'accounting', label: 'Accounting', icon: 'book-open-outline',
    children: [
      { label: 'Client Overview', icon: 'view-grid-outline' }, { label: 'Books Review', path: '/books-review', icon: 'clipboard-check-outline' }, { label: 'Approvals', path: '/approvals', icon: 'check-decagram-outline' },
      { label: 'Bank Accounts', path: '/bank-accounts', icon: 'bank-outline' }, { label: 'Bank Transactions', path: '/bank-transactions', icon: 'bank-outline' }, { label: 'Integration Transactions', path: '/integration-transactions', icon: 'swap-horizontal' },
      { label: 'Reconcile', path: '/reconcile', icon: 'bank-check' }, { label: 'Rules', path: '/bank-rules', icon: 'filter-variant' }, { label: 'Chart of Accounts', path: '/chart-of-accounts', icon: 'book-open-variant' },
      { label: 'Recurring Transactions', path: '/recurring-templates', icon: 'autorenew' }, { label: 'Fixed Assets', path: '/fixed-assets', icon: 'office-building-outline' }, { label: 'Journal', path: '/journal-entries', icon: 'book-open-page-variant-outline' },
    ],
  },
  {
    id: 'reports', label: 'Reports', icon: 'chart-bar',
    children: [
      { label: 'Standard Reports', path: '/standard-reports', icon: 'view-list-outline' },
      { label: 'Profit & Loss', path: '/pnl', icon: 'chart-line' },
      { label: 'Balance Sheet', path: '/balance-sheet', icon: 'scale-balance' },
      { label: 'General Ledger', path: '/general-ledger', icon: 'format-list-numbered' },
      { label: 'Cash Flows', path: '/cash-flow', icon: 'cash-sync' }, { label: 'Cash Activity', path: '/cash-activity', icon: 'bank-transfer' }, { label: 'Custom Reports', path: '/custom-reports', icon: 'file-chart-outline' },
      { label: 'Management Reports', path: '/management-reports', icon: 'finance' }, { label: 'Performance Center', path: '/performance-center', icon: 'trending-up' }, { label: 'Financial Planning', path: '/financial-planning', icon: 'chart-box-outline' },
      { label: 'Trial Balance', path: '/trial-balance', icon: 'table-check' },
    ],
  },
  {
    id: 'inventory', label: 'Inventory', icon: 'package-variant-closed',
    children: [
      { label: 'Overview', path: '/inventory-overview', icon: 'view-dashboard-outline' }, { label: 'Inventory', path: '/inventory-items', icon: 'package-variant-closed' }, { label: 'Purchase Orders', path: '/purchase-orders', icon: 'clipboard-list-outline' },
      { label: 'Item Receipts', path: '/item-receipts', icon: 'package-down' }, { label: 'Sales Orders', path: '/sales-orders', icon: 'cart-outline' }, { label: 'Shipping Labels', path: '/shipping-labels', icon: 'truck-outline' },
    ],
  },
  {
    id: 'setup', label: 'Setup', icon: 'cog-outline',
    children: [
      { label: 'Entity', path: '/entity', icon: 'domain' }, { label: 'Company Settings', path: '/company-settings', icon: 'cog-outline' }, { label: 'Chart of Accounts', path: '/chart-of-accounts', icon: 'book-open-variant' },
      { label: 'Cost Centers', path: '/cost-centers', icon: 'tag-outline' }, { label: 'Users', path: '/users', icon: 'account-group-outline' }, { label: 'Activity Log', path: '/activity-log', icon: 'history' },
      { label: 'Tax Codes', path: '/tax-codes', icon: 'percent-outline' }, { label: 'Fiscal Periods', path: '/fiscal-periods', icon: 'calendar-blank-outline' },
    ],
  },
  {
    id: 'more', label: 'More', icon: 'view-grid-outline',
    children: [
      { label: 'Send Documents', path: '/send-documents', icon: 'upload-outline' },
      { label: 'Messages', path: '/messages', icon: 'message-outline' },
      { label: 'Spreadsheet Sync', path: '/spreadsheet-sync', icon: 'file-export-outline' },
      { label: 'Settings', path: '/settings', icon: 'cog-outline' },
    ],
  },
];

function go(item: NavItem) {
  if (!item.path) return;
  router.push({ pathname: item.path as never, params: item.params } as never);
}

function animate() {
  LayoutAnimation.configureNext(LayoutAnimation.create(200, LayoutAnimation.Types.easeOut, LayoutAnimation.Properties.opacity));
}

export default function MoreScreen() {
  const theme = useTheme<AppTheme>();
  const c = theme.app;
  const canOpen = useCanOpen();
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const visibleShortcuts = useMemo(() => SHORTCUTS.filter(s => !s.path || canOpen(s.path)), [canOpen]);

  const visibleCategories = useMemo(
    () => CATEGORIES
      .map(cat => ({ ...cat, children: cat.children.filter(ch => !ch.path || canOpen(ch.path)) }))
      .filter(cat => cat.children.length > 0),
    [canOpen],
  );

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const groups: Array<{ label: string; items: NavItem[] }> = [];
    const shortcutMatches = visibleShortcuts.filter(s => s.label.toLowerCase().includes(q));
    if (shortcutMatches.length > 0) groups.push({ label: 'Frequently used', items: shortcutMatches });
    for (const cat of visibleCategories) {
      const matches = cat.children.filter(ch => ch.label.toLowerCase().includes(q));
      if (matches.length > 0) groups.push({ label: cat.label, items: matches });
    }
    return groups;
  }, [query, visibleShortcuts, visibleCategories]);

  function toggleCategory(id: string) {
    animate();
    setExpandedId(prev => (prev === id ? null : id));
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="More" />

      <View style={{ paddingHorizontal: spacing.md, paddingTop: spacing.sm }}>
        <AppTextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search menu items"
          left={<MaterialCommunityIcons name="magnify" size={18} color={c.mutedForeground} />}
          wrapperStyle={[styles.searchWrapper, { backgroundColor: c.muted }]}
        />
      </View>

      <ScrollView contentContainerStyle={{ paddingTop: spacing.md, paddingBottom: 80 }}>
        {searchResults ? (
          searchResults.length === 0 ? (
            <Text style={{ color: c.mutedForeground, textAlign: 'center', marginTop: spacing.xl }}>No menu items match "{query}".</Text>
          ) : (
            searchResults.map(group => (
              <View key={group.label} style={{ marginBottom: spacing.md }}>
                <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>{group.label}</Text>
                {group.items.map(item => (
                  <SearchResultRow key={item.label} item={item} theme={theme} />
                ))}
              </View>
            ))
          )
        ) : (
          <>
            <Text style={[styles.sectionLabel, { color: c.foreground, fontFamily: fontFamily.semibold, fontSize: 15 }]}>Frequently used</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shortcutRow}>
              {visibleShortcuts.map(s => (
                <Pressable key={s.label} onPress={() => go(s)} style={styles.shortcutTile}>
                  <View style={[styles.shortcutCircle, { backgroundColor: c.muted, borderColor: c.border }]}>
                    <MaterialCommunityIcons name={s.icon!} size={24} color={c.primary} />
                  </View>
                  <Text style={{ color: c.foreground, fontFamily: fontFamily.medium, fontSize: 12, marginTop: 8, textAlign: 'center' }} numberOfLines={1}>
                    {s.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            <Text style={[styles.sectionLabel, { color: c.foreground, fontFamily: fontFamily.semibold, fontSize: 15, marginTop: spacing.md }]}>All</Text>
            <View style={styles.grid}>
              {chunkPairs(visibleCategories).map((pair, i) => (
                <View key={i}>
                  <View style={styles.gridRow}>
                    {pair.map(cat => {
                      const isExpanded = expandedId === cat.id;
                      return (
                        <Pressable
                          key={cat.id}
                          onPress={() => toggleCategory(cat.id)}
                          style={[
                            styles.categoryCard,
                            { backgroundColor: c.surface, borderColor: isExpanded ? c.primary : c.border, borderWidth: isExpanded ? 2 : 1 },
                          ]}
                        >
                          <View style={[styles.categoryIconCircle, { backgroundColor: c.primary }]}>
                            <MaterialCommunityIcons name={cat.icon} size={20} color={c.primaryForeground} />
                          </View>
                          <Text style={{ color: c.foreground, fontFamily: fontFamily.medium, fontSize: 15 }} numberOfLines={1}>
                            {cat.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                    {pair.length === 1 ? <View style={styles.categoryCard} /> : null}
                  </View>

                  {pair.some(cat => cat.id === expandedId) ? (
                    <View style={{ paddingHorizontal: spacing.md, marginBottom: spacing.sm }}>
                      {pair.find(cat => cat.id === expandedId)!.children.map(child => (
                        <MenuItemRow key={child.label} item={child} theme={theme} />
                      ))}
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function chunkPairs<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += 2) out.push(items.slice(i, i + 2));
  return out;
}

function SearchResultRow({ item, theme }: { item: NavItem; theme: AppTheme }) {
  const c = theme.app;
  const disabled = !item.path;
  return (
    <Pressable
      disabled={disabled}
      onPress={() => go(item)}
      style={({ pressed }) => [styles.itemRow, { backgroundColor: pressed ? c.muted : c.surface, borderBottomColor: c.border, paddingLeft: spacing.md }]}
    >
      <MaterialCommunityIcons name={item.icon ?? 'circle-small'} size={20} color={disabled ? c.border : c.mutedForeground} />
      <Text style={[styles.itemLabel, { color: disabled ? c.mutedForeground : c.foreground }]} numberOfLines={1}>{item.label}</Text>
      {disabled ? <Text style={{ color: c.mutedForeground, fontSize: 11 }}>Desktop only</Text> : <MaterialCommunityIcons name="chevron-right" size={18} color={c.mutedForeground} />}
    </Pressable>
  );
}

function MenuItemRow({ item, theme }: { item: NavItem; theme: AppTheme }) {
  const c = theme.app;
  const disabled = !item.path;
  return (
    <Pressable
      disabled={disabled}
      onPress={() => go(item)}
      style={({ pressed }) => [styles.itemRow, { backgroundColor: pressed ? c.muted : c.surface, borderBottomWidth: 0, borderColor: c.border, borderWidth: 1, borderRadius: 8, marginBottom: 6 }]}
    >
      <MaterialCommunityIcons name={item.icon ?? 'circle-small'} size={20} color={disabled ? c.border : c.mutedForeground} />
      <Text style={[styles.itemLabel, { color: disabled ? c.mutedForeground : c.foreground }]} numberOfLines={1}>{item.label}</Text>
      {disabled ? <Text style={{ color: c.mutedForeground, fontSize: 11 }}>Desktop only</Text> : <MaterialCommunityIcons name="chevron-right" size={18} color={c.mutedForeground} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  searchWrapper: { borderRadius: 8, height: 44, borderWidth: 0 },
  sectionLabel: { paddingLeft: spacing.md, marginBottom: 12 },
  shortcutRow: { paddingHorizontal: spacing.md, gap: 12 },
  shortcutTile: { width: 80, alignItems: 'center' },
  shortcutCircle: { width: 64, height: 64, borderRadius: 32, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  grid: { paddingHorizontal: spacing.md },
  gridRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  categoryCard: { flex: 1, height: 100, borderRadius: 12, padding: 12, justifyContent: 'space-between' },
  categoryIconCircle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    height: 52, paddingHorizontal: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  itemLabel: { flex: 1, fontFamily: fontFamily.regular, fontSize: 15 },
});
