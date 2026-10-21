import { View } from 'react-native';
import { Appbar, useTheme } from 'react-native-paper';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ExpenseForm } from '../../components/forms/ExpenseForm';
import type { AppTheme } from '../../theme';

export default function NewExpenseScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Appbar.Header statusBarHeight={insets.top} style={{ backgroundColor: theme.app.surface }}>
        <Appbar.BackAction onPress={() => router.back()} color={theme.app.foreground} />
        <Appbar.Content title="New Expense" titleStyle={{ color: theme.app.foreground }} />
      </Appbar.Header>
      <ExpenseForm />
    </View>
  );
}
