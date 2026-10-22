import { View, ScrollView } from 'react-native';
import { Text, List, Divider, useTheme } from 'react-native-paper';
import { router } from 'expo-router';
import { useAuth } from '../../hooks/useAuth';
import { AppHeader } from '../../components/AppHeader';
import type { AppTheme } from '../../theme';
import { spacing, fontFamily } from '../../theme';

type Item = { title: string; path: string; icon: string };
type Section = { label: string; items: Item[] };

// Grouped the same way the drawer's own AR/AP/Accounting/Reports/AI
// sections are, so this screen reads as an index of the same areas
// rather than one long undifferentiated list — it was a flat 25+-item
// list before this, with no ScrollView wrapping it (items past the fold
// were clipped on a small screen, not just visually noisy).
const SECTIONS: Section[] = [
  {
    label: 'Reports', items: [
      { title: 'Profit & Loss', path: '/pnl', icon: 'chart-line' },
      { title: 'Balance Sheet', path: '/balance-sheet', icon: 'scale-balance' },
      { title: 'Trial Balance', path: '/trial-balance', icon: 'table-check' },
      { title: 'Statement of Cash Flows', path: '/cash-flow', icon: 'cash-sync' },
      { title: 'General Ledger', path: '/general-ledger', icon: 'format-list-numbered' },
      { title: 'AR Aging', path: '/ar-aging', icon: 'calendar-clock-outline' },
      { title: 'AP Aging', path: '/ap-aging', icon: 'calendar-clock-outline' },
      { title: 'Customer Statement', path: '/customer-statement', icon: 'file-account-outline' },
      { title: '1099s', path: '/1099s', icon: 'file-document-outline' },
    ],
  },
  {
    label: 'Accounts Receivable', items: [
      { title: 'Payments', path: '/payments', icon: 'cash-check' },
      { title: 'Credit Memos', path: '/credit-memos', icon: 'file-document-minus-outline' },
    ],
  },
  {
    label: 'Accounts Payable', items: [
      { title: 'AP Overview', path: '/ap-overview', icon: 'view-dashboard-outline' },
      { title: 'Bills', path: '/bills', icon: 'file-document-outline' },
      { title: 'Bill Payments', path: '/bill-payments', icon: 'cash-fast' },
      { title: 'Vendor Credits', path: '/vendor-credits', icon: 'file-document-minus-outline' },
      { title: 'Checks', path: '/checks', icon: 'checkbook' },
      { title: 'Contractors', path: '/contractors', icon: 'account-hard-hat-outline' },
    ],
  },
  {
    label: 'Accounting', items: [
      { title: 'Chart of Accounts', path: '/chart-of-accounts', icon: 'book-open-variant' },
      { title: 'Journal Entries', path: '/journal-entries', icon: 'book-open-page-variant-outline' },
      { title: 'Bank Accounts', path: '/bank-accounts', icon: 'bank-outline' },
      { title: 'Bank Transactions', path: '/bank-transactions', icon: 'bank-outline' },
      { title: 'Reconcile', path: '/reconcile', icon: 'bank-check' },
      { title: 'Receipts', path: '/receipts', icon: 'receipt' },
      { title: 'Bank Rules', path: '/bank-rules', icon: 'filter-variant' },
      { title: 'Fixed Assets', path: '/fixed-assets', icon: 'office-building-outline' },
      { title: 'Approvals', path: '/approvals', icon: 'check-decagram-outline' },
      { title: 'Integration Transactions', path: '/integration-transactions', icon: 'swap-horizontal' },
      { title: 'Recurring Transactions', path: '/recurring-templates', icon: 'autorenew' },
    ],
  },
  {
    label: 'AI', items: [
      { title: 'AI Document Inbox', path: '/inbox', icon: 'inbox-arrow-down-outline' },
      { title: 'Suspense', path: '/suspense', icon: 'help-circle-outline' },
      { title: 'Coding Rules', path: '/coding-rules', icon: 'creation' },
    ],
  },
  {
    label: 'Setup', items: [
      { title: 'Entity', path: '/entity', icon: 'domain' },
      { title: 'Company Settings', path: '/company-settings', icon: 'cog-outline' },
      { title: 'Cost Centers', path: '/cost-centers', icon: 'tag-outline' },
      { title: 'Users', path: '/users', icon: 'account-group-outline' },
      { title: 'Activity Log', path: '/activity-log', icon: 'history' },
      { title: 'Tax Codes', path: '/tax-codes', icon: 'percent-outline' },
      { title: 'Fiscal Periods', path: '/fiscal-periods', icon: 'calendar-blank-outline' },
    ],
  },
];

export default function MoreScreen() {
  const theme = useTheme<AppTheme>();
  const { user } = useAuth();

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="More" />

      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }}>
        {user && (
          <View style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.md }}>
            <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold }}>{user.full_name}</Text>
            <Text style={{ color: theme.app.mutedForeground, marginTop: 2 }}>{user.email}</Text>
          </View>
        )}
        <Divider />

        {SECTIONS.map(section => (
          <View key={section.label}>
            <SectionLabel theme={theme} text={section.label} />
            {section.items.map(item => (
              <List.Item
                key={item.path}
                title={item.title}
                onPress={() => router.push(item.path as never)}
                left={props => <List.Icon {...props} icon={item.icon} color={theme.app.foreground} />}
                titleStyle={{ color: theme.app.foreground }}
              />
            ))}
            <Divider />
          </View>
        ))}

        <List.Item
          title="Settings"
          description="Account, security, notifications, appearance"
          onPress={() => router.push('/settings')}
          left={props => <List.Icon {...props} icon="cog-outline" color={theme.app.foreground} />}
          titleStyle={{ color: theme.app.foreground }}
          descriptionStyle={{ color: theme.app.mutedForeground }}
        />
      </ScrollView>
    </View>
  );
}

function SectionLabel({ theme, text }: { theme: AppTheme; text: string }) {
  return (
    <Text style={{ color: theme.app.mutedForeground, fontSize: 11, fontFamily: fontFamily.semibold, letterSpacing: 0.5, padding: spacing.md, paddingBottom: spacing.xs }}>
      {text.toUpperCase()}
    </Text>
  );
}
