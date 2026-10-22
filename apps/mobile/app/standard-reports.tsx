import { View, ScrollView, Pressable } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { AppHeader } from '../components/AppHeader';
import { AppCard } from '../components/ui/AppCard';
import { spacing, typeScale, fontFamily, type AppTheme } from '../theme';

type ReportLink = { path: string; name: string; description: string };
type ReportGroup = { heading: string; reports: ReportLink[] };

// Mirrors web's StandardReportsPage.tsx grouping — a pure index of
// already-built reports, no API call of its own.
const GROUPS: ReportGroup[] = [
  {
    heading: 'Business overview', reports: [
      { path: '/pnl', name: 'Profit and Loss', description: 'Revenue and expenses for a period, with gross profit and net income.' },
      { path: '/balance-sheet', name: 'Balance Sheet', description: 'Assets, liabilities, and equity as of a point in time.' },
      { path: '/cash-flow', name: 'Statement of Cash Flows', description: 'The change in cash for a period, explained as operating, investing and financing activities.' },
    ],
  },
  {
    heading: 'For my accountant', reports: [
      { path: '/general-ledger', name: 'General Ledger', description: 'Detailed transactions, opening balances, and running balances grouped by account.' },
      { path: '/trial-balance', name: 'Trial Balance', description: 'Debit and credit balances for every account as of a chosen date.' },
      { path: '/cash-activity', name: 'Cash Activity by Account', description: 'Every movement in one bank account over a period, with a running balance.' },
      { path: '/reconcile-history', name: 'Reconciliation Reports', description: 'Every completed reconciliation, fixed as it was the day it was finished.' },
    ],
  },
  {
    heading: 'Who owes you', reports: [
      { path: '/ar-aging', name: 'Accounts Receivable Aging Summary', description: 'Outstanding customer invoices bucketed by days past due.' },
    ],
  },
  {
    heading: 'What you owe', reports: [
      { path: '/ap-aging', name: 'Accounts Payable Aging Summary', description: 'Unpaid vendor bills bucketed by days past due.' },
    ],
  },
  {
    heading: 'Expenses and vendors', reports: [
      { path: '/1099s', name: '1099 Transaction Detail Report', description: 'Annual payments to 1099 vendors, grouped by vendor and tax ID.' },
    ],
  },
];

export default function StandardReportsScreen() {
  const theme = useTheme<AppTheme>();

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Standard Reports" />
      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.lg }}>
        {GROUPS.map(group => (
          <View key={group.heading}>
            <Text style={{
              color: theme.app.mutedForeground, fontSize: typeScale.caption, fontFamily: fontFamily.semibold,
              textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: spacing.sm,
            }}>
              {group.heading}
            </Text>
            <AppCard style={{ padding: 0 }}>
              {group.reports.map((r, i) => (
                <Pressable
                  key={r.path}
                  onPress={() => router.push(r.path as never)}
                  style={({ pressed }) => [
                    {
                      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
                      paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
                      opacity: pressed ? 0.6 : 1,
                    },
                    i !== group.reports.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.app.border },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium }}>{r.name}</Text>
                    <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption, marginTop: 2 }}>{r.description}</Text>
                  </View>
                  <MaterialCommunityIcons name="chevron-right" size={18} color={theme.app.mutedForeground} />
                </Pressable>
              ))}
            </AppCard>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
