import { View, StyleSheet } from 'react-native';
import { Text, List, Divider, useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuth } from '../../hooks/useAuth';
import type { AppTheme } from '../../theme';
import { spacing, typeScale } from '../../theme';

const STUB_ITEMS = [
  { icon: 'chart-box-outline', label: 'Reports' },
  { icon: 'book-open-variant', label: 'Chart of Accounts' },
  { icon: 'bank-check', label: 'Reconciliation' },
] as const;

export default function MoreScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background, paddingTop: insets.top }}>
      <View style={styles.header}>
        <Text style={{ fontSize: typeScale.h1, fontWeight: '700', color: theme.app.foreground }}>More</Text>
        {user && <Text style={{ color: theme.app.mutedForeground, marginTop: 2 }}>{user.full_name} · {user.email}</Text>}
      </View>

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
          description="Coming in a later chunk"
          left={props => <List.Icon {...props} icon={item.icon} color={theme.app.mutedForeground} />}
          titleStyle={{ color: theme.app.foreground }}
          descriptionStyle={{ color: theme.app.mutedForeground }}
          disabled
        />
      ))}

      <Divider style={{ marginVertical: spacing.md }} />

      <List.Item
        title="Sign out"
        onPress={() => { void logout(); }}
        left={props => <List.Icon {...props} icon="logout" color={theme.app.destructive} />}
        titleStyle={{ color: theme.app.destructive, fontWeight: '600' }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { padding: spacing.md, paddingBottom: spacing.sm },
});
