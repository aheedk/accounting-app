import { useState } from 'react';
import { View, StyleSheet, ScrollView, Text as RNText } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../hooks/useAuth';
import { AppHeader } from '../../components/AppHeader';
import { AppButton } from '../../components/ui/AppButton';
import { AppTextInput } from '../../components/ui/AppTextInput';
import { DateField } from '../../components/DateField';
import { startReconciliation } from '../../services/api';
import { pickErr } from '../../services/apiClient';
import { spacing, type AppTheme } from '../../theme';

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Service charge/interest are entered only here, same as web — not
 * editable once the worksheet opens (they become real posted
 * expense/deposit rows, pre-ticked, at Start). No offset-account pickers
 * for either: left optional and skippable, since most reconciliations
 * don't need them and this keeps the form short; a user who needs them
 * can still do that part on web for now.
 */
export default function StartReconciliationScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { accountId } = useLocalSearchParams<{ accountId: string }>();
  const { activeBusinessId } = useAuth();
  const queryClient = useQueryClient();

  const [endingBalance, setEndingBalance] = useState('');
  const [endingDate, setEndingDate] = useState(todayIso());
  const [serverError, setServerError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  async function start() {
    if (endingBalance.trim() === '' || Number.isNaN(parseFloat(endingBalance))) {
      setServerError('Enter the statement ending balance.');
      return;
    }
    setServerError(null);
    setStarting(true);
    try {
      const recon = await startReconciliation(activeBusinessId!, {
        account_id: accountId!,
        statement_ending_balance: endingBalance,
        statement_ending_date: endingDate,
      });
      await queryClient.invalidateQueries({ queryKey: ['reconciliation-status'] });
      router.replace({ pathname: '/reconcile/[id]', params: { id: recon.id } });
    } catch (e) {
      setServerError(pickErr(e));
    } finally {
      setStarting(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Start Reconciling" leading="back" />
      <ScrollView contentContainerStyle={styles.content}>
        <RNText style={{ color: theme.app.mutedForeground, marginBottom: spacing.md }}>
          Enter the ending balance and date from your bank statement.
        </RNText>

        <AppTextInput
          label="Statement ending balance"
          placeholder="0.00"
          value={endingBalance}
          onChangeText={(v) => setEndingBalance(v.replace(/[^0-9.-]/g, ''))}
          keyboardType="numbers-and-punctuation"
          left={<Text style={{ color: theme.app.mutedForeground }}>$</Text>}
          containerStyle={{ marginBottom: spacing.md }}
        />

        <DateField label="Statement ending date" value={endingDate} onChange={setEndingDate} />

        {serverError ? <Text style={{ color: theme.app.destructive, marginTop: spacing.sm }}>{serverError}</Text> : null}
      </ScrollView>

      <View style={[styles.footer, { borderColor: theme.app.border, backgroundColor: theme.app.surface, paddingBottom: insets.bottom + spacing.sm }]}>
        <AppButton variant="outline" onPress={() => router.back()}>Cancel</AppButton>
        <AppButton onPress={() => void start()} loading={starting} style={{ flex: 1 }}>Start</AppButton>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md },
  footer: {
    flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
