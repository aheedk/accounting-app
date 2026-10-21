import { View, StyleSheet } from 'react-native';
import { List, Text, Divider, useTheme } from 'react-native-paper';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AppTheme } from '../../theme';
import { spacing, typeScale } from '../../theme';

const STUB_ITEMS = [
  { icon: 'checkbook', label: 'Check', note: 'Check writing stays on desktop' },
  { icon: 'file-document-outline', label: 'Invoice', note: 'Coming in a later chunk' },
  { icon: 'book-open-page-variant-outline', label: 'Journal Entry', note: 'Journal entries stay on desktop' },
] as const;

export default function CreateScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background, paddingTop: insets.top }}>
      <View style={styles.header}>
        <Text style={{ fontSize: typeScale.h1, fontWeight: '700', color: theme.app.foreground }}>Create</Text>
      </View>

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

const styles = StyleSheet.create({
  header: { padding: spacing.md, paddingBottom: spacing.sm },
});
