import { View } from 'react-native';
import { Appbar, useTheme } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../../hooks/useAuth';
import { getExpense } from '../../../services/api';
import { ExpenseForm } from '../../../components/forms/ExpenseForm';
import { LoadingIndicator } from '../../../components/LoadingIndicator';
import { ErrorState } from '../../../components/ErrorState';
import type { AppTheme } from '../../../theme';

export default function EditExpenseScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { activeBusinessId } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();

  const query = useQuery({
    queryKey: ['expense', activeBusinessId, id],
    queryFn: () => getExpense(activeBusinessId!, id),
    enabled: !!activeBusinessId,
  });

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Appbar.Header statusBarHeight={insets.top} style={{ backgroundColor: theme.app.surface }}>
        <Appbar.BackAction onPress={() => router.back()} color={theme.app.foreground} />
        <Appbar.Content title="Edit Expense" titleStyle={{ color: theme.app.foreground }} />
      </Appbar.Header>
      {query.isLoading ? (
        <LoadingIndicator />
      ) : query.error || !query.data ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <ExpenseForm existing={query.data} existingId={id} />
      )}
    </View>
  );
}
