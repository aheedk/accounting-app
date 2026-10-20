import { View, StyleSheet } from 'react-native';
import { Text, Button, useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { AppTheme } from '../theme';
import { spacing } from '../theme';

export function ErrorState({ message = 'Something went wrong loading this.', onRetry }: { message?: string; onRetry: () => void }) {
  const theme = useTheme<AppTheme>();
  return (
    <View style={styles.container}>
      <MaterialCommunityIcons name="alert-circle-outline" size={32} color={theme.app.mutedForeground} />
      <Text style={{ color: theme.app.mutedForeground, textAlign: 'center', marginTop: spacing.sm, marginBottom: spacing.md }}>
        {message}
      </Text>
      <Button mode="outlined" onPress={onRetry}>Try again</Button>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxl },
});
