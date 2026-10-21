import { View } from 'react-native';
import { Text, List, Divider, useTheme } from 'react-native-paper';
import { router } from 'expo-router';
import { useAuth } from '../../hooks/useAuth';
import { AppHeader } from '../../components/AppHeader';
import type { AppTheme } from '../../theme';
import { spacing, fontFamily } from '../../theme';

const STUB_ITEMS = [
  { icon: 'chart-box-outline', label: 'Reports' },
  { icon: 'book-open-variant', label: 'Chart of Accounts' },
  { icon: 'bank-check', label: 'Reconciliation' },
] as const;

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
      <Divider />

      {STUB_ITEMS.map(item => (
        <List.Item
          key={item.label}
          title={item.label}
          description="Available on desktop"
          left={props => <List.Icon {...props} icon={item.icon} color={theme.app.mutedForeground} />}
          titleStyle={{ color: theme.app.foreground }}
          descriptionStyle={{ color: theme.app.mutedForeground }}
          disabled
        />
      ))}

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
