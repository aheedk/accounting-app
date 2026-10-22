import { View } from 'react-native';
import { List, Divider, Text, useTheme } from 'react-native-paper';
import { router } from 'expo-router';
import { AppHeader } from '../../components/AppHeader';
import { useCanOpen } from '../../lib/roleAccess';
import type { AppTheme } from '../../theme';
import { spacing } from '../../theme';

const STUB_ITEMS = [
  { icon: 'file-document-outline', label: 'Invoice', note: 'Available on desktop' },
  { icon: 'checkbook', label: 'Check', note: 'Available on desktop' },
  { icon: 'book-open-page-variant-outline', label: 'Journal Entry', note: 'Available on desktop' },
] as const;

export default function CreateScreen() {
  const theme = useTheme<AppTheme>();
  const canOpen = useCanOpen();
  // A view-only login and a client login can't post a new expense/deposit —
  // same "no /new forms" rule as every other role-gated form in this app
  // (see lib/roleAccess.ts), not a desktop-only feature gap.
  const canCreate = canOpen('/expense/new');

  if (!canCreate) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <AppHeader title="Create" />
        <View style={{ padding: spacing.lg, alignItems: 'center' }}>
          <Text style={{ color: theme.app.mutedForeground, textAlign: 'center' }}>
            Your role doesn't have permission to create new transactions.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Create" />

      <List.Item
        title="Expense"
        description="Record a payment you just made"
        onPress={() => router.push('/expense/new')}
        left={props => <List.Icon {...props} icon="cash-minus" color={theme.app.primary} />}
        titleStyle={{ color: theme.app.foreground, fontWeight: '600' }}
        descriptionStyle={{ color: theme.app.mutedForeground }}
      />
      <List.Item
        title="Deposit"
        description="Record money received into a bank account"
        onPress={() => router.push('/deposit/new')}
        left={props => <List.Icon {...props} icon="cash-plus" color={theme.app.primary} />}
        titleStyle={{ color: theme.app.foreground, fontWeight: '600' }}
        descriptionStyle={{ color: theme.app.mutedForeground }}
      />
      <List.Item
        title="Payment"
        description="Apply a customer payment to open invoices"
        onPress={() => router.push('/payment/new')}
        left={props => <List.Icon {...props} icon="cash-check" color={theme.app.primary} />}
        titleStyle={{ color: theme.app.foreground, fontWeight: '600' }}
        descriptionStyle={{ color: theme.app.mutedForeground }}
      />
      <List.Item
        title="Pay Bills"
        description="Pay a vendor's open bills"
        onPress={() => router.push('/bill-payment/new')}
        left={props => <List.Icon {...props} icon="cash-fast" color={theme.app.primary} />}
        titleStyle={{ color: theme.app.foreground, fontWeight: '600' }}
        descriptionStyle={{ color: theme.app.mutedForeground }}
      />
      <Divider style={{ marginVertical: spacing.sm }} />

      {STUB_ITEMS.map(item => (
        <List.Item
          key={item.label}
          title={item.label}
          description={item.note}
          left={props => <List.Icon {...props} icon={item.icon} color={theme.app.mutedForeground} />}
          titleStyle={{ color: theme.app.mutedForeground }}
          descriptionStyle={{ color: theme.app.mutedForeground }}
          disabled
        />
      ))}
    </View>
  );
}
