import { View } from 'react-native';
import { Appbar, useTheme } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../../hooks/useAuth';
import { getDeposit } from '../../../services/api';
import { DepositForm } from '../../../components/forms/DepositForm';
import { LoadingIndicator } from '../../../components/LoadingIndicator';
import { ErrorState } from '../../../components/ErrorState';
import type { AppTheme } from '../../../theme';

export default function EditDepositScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { activeBusinessId } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();

  const query = useQuery({
    queryKey: ['deposit', activeBusinessId, id],
    queryFn: () => getDeposit(activeBusinessId!, id),
    enabled: !!activeBusinessId,
  });

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Appbar.Header statusBarHeight={insets.top} style={{ backgroundColor: theme.app.surface }}>
        <Appbar.BackAction onPress={() => router.back()} color={theme.app.foreground} />
        <Appbar.Content title="Edit Deposit" titleStyle={{ color: theme.app.foreground }} />
      </Appbar.Header>
      {query.isLoading ? (
        <LoadingIndicator />
      ) : query.error || !query.data ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <DepositForm existing={query.data} existingId={id} />
      )}
    </View>
  );
}
