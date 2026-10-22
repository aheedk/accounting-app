import { View } from 'react-native';
import { Text, List, Divider, useTheme } from 'react-native-paper';
import { router } from 'expo-router';
import { useAuth } from '../../hooks/useAuth';
import { AppHeader } from '../../components/AppHeader';
import type { AppTheme } from '../../theme';
import { spacing, fontFamily } from '../../theme';

export default function MoreScreen() {
  const theme = useTheme<AppTheme>();
  const { user } = useAuth();

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="More" />

      {user && (
        <View style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.md }}>
          <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.semibold }}>{user.full_name}</Text>
          <Text style={{ color: theme.app.mutedForeground, marginTop: 2 }}>{user.email}</Text>
        </View>
      )}
      <Divider />

      <List.Item
        title="Profit & Loss"
        onPress={() => router.push('/pnl')}
        left={props => <List.Icon {...props} icon="chart-line" color={theme.app.foreground} />}
        titleStyle={{ color: theme.app.foreground }}
      />
      <List.Item
        title="Balance Sheet"
        onPress={() => router.push('/balance-sheet')}
        left={props => <List.Icon {...props} icon="scale-balance" color={theme.app.foreground} />}
        titleStyle={{ color: theme.app.foreground }}
      />
      <List.Item
        title="Trial Balance"
        onPress={() => router.push('/trial-balance')}
        left={props => <List.Icon {...props} icon="table-check" color={theme.app.foreground} />}
        titleStyle={{ color: theme.app.foreground }}
      />
      <List.Item
        title="Statement of Cash Flows"
        onPress={() => router.push('/cash-flow')}
        left={props => <List.Icon {...props} icon="cash-sync" color={theme.app.foreground} />}
        titleStyle={{ color: theme.app.foreground }}
      />
      <List.Item
        title="General Ledger"
        onPress={() => router.push('/general-ledger')}
        left={props => <List.Icon {...props} icon="format-list-numbered" color={theme.app.foreground} />}
        titleStyle={{ color: theme.app.foreground }}
      />
      <List.Item
        title="AI Document Inbox"
        onPress={() => router.push('/inbox')}
        left={props => <List.Icon {...props} icon="inbox-arrow-down-outline" color={theme.app.foreground} />}
        titleStyle={{ color: theme.app.foreground }}
      />
      <List.Item
        title="Chart of Accounts"
        onPress={() => router.push('/chart-of-accounts')}
        left={props => <List.Icon {...props} icon="book-open-variant" color={theme.app.foreground} />}
        titleStyle={{ color: theme.app.foreground }}
      />
      <List.Item
        title="Journal Entries"
        onPress={() => router.push('/journal-entries')}
        left={props => <List.Icon {...props} icon="book-open-page-variant-outline" color={theme.app.foreground} />}
        titleStyle={{ color: theme.app.foreground }}
      />
      <List.Item
        title="AR Aging"
        onPress={() => router.push('/ar-aging')}
        left={props => <List.Icon {...props} icon="calendar-clock-outline" color={theme.app.foreground} />}
        titleStyle={{ color: theme.app.foreground }}
      />
      <List.Item
        title="AP Aging"
        onPress={() => router.push('/ap-aging')}
        left={props => <List.Icon {...props} icon="calendar-clock-outline" color={theme.app.foreground} />}
        titleStyle={{ color: theme.app.foreground }}
      />
      <List.Item
        title="Payments"
        onPress={() => router.push('/payments')}
        left={props => <List.Icon {...props} icon="cash-check" color={theme.app.foreground} />}
        titleStyle={{ color: theme.app.foreground }}
      />
      <List.Item
        title="Bills"
        onPress={() => router.push('/bills')}
        left={props => <List.Icon {...props} icon="file-document-outline" color={theme.app.foreground} />}
        titleStyle={{ color: theme.app.foreground }}
      />
      <List.Item
        title="Bill Payments"
        onPress={() => router.push('/bill-payments')}
        left={props => <List.Icon {...props} icon="cash-fast" color={theme.app.foreground} />}
        titleStyle={{ color: theme.app.foreground }}
      />
      <List.Item
        title="Credit Memos"
        onPress={() => router.push('/credit-memos')}
        left={props => <List.Icon {...props} icon="file-document-minus-outline" color={theme.app.foreground} />}
        titleStyle={{ color: theme.app.foreground }}
      />
      <List.Item
        title="Vendor Credits"
        onPress={() => router.push('/vendor-credits')}
        left={props => <List.Icon {...props} icon="file-document-minus-outline" color={theme.app.foreground} />}
        titleStyle={{ color: theme.app.foreground }}
      />
      <List.Item
        title="Bank Transactions"
        onPress={() => router.push('/bank-transactions')}
        left={props => <List.Icon {...props} icon="bank-outline" color={theme.app.foreground} />}
        titleStyle={{ color: theme.app.foreground }}
      />
      <List.Item
        title="Reconcile"
        onPress={() => router.push('/reconcile')}
        left={props => <List.Icon {...props} icon="bank-check" color={theme.app.foreground} />}
        titleStyle={{ color: theme.app.foreground }}
      />

      <Divider style={{ marginVertical: spacing.md }} />

      <List.Item
        title="Settings"
        description="Account, security, notifications, appearance"
        onPress={() => router.push('/settings')}
        left={props => <List.Icon {...props} icon="cog-outline" color={theme.app.foreground} />}
        titleStyle={{ color: theme.app.foreground }}
        descriptionStyle={{ color: theme.app.mutedForeground }}
      />
    </View>
  );
}
