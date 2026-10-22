import { View, StyleSheet } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { listReceipts, type ReceiptRow } from '../services/api';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { fmtShortDate } from '../lib/money';
import { spacing, typeScale, fontFamily, type AppTheme } from '../theme';

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Every receipt/file attached to a transaction, across the whole business
 * (no entity filter — this is the full reference list). Not the AI
 * Document Inbox — that's staged email imports awaiting coding, this is
 * already-linked attachments. Reference-only, no tap-through: the linked
 * document could be any of 7 different entity types, several without a
 * mobile screen yet, so no navigation is guessed here. */
export default function ReceiptsScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { activeBusinessId } = useAuth();

  const query = useQuery({
    queryKey: ['receipts', activeBusinessId],
    queryFn: () => listReceipts(activeBusinessId!),
    enabled: !!activeBusinessId,
  });

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <AppHeader title="Receipts" />

      {query.isLoading ? (
        <LoadingIndicator />
      ) : query.error ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <FlashList
          data={query.data ?? []}
          keyExtractor={r => r.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
          ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.app.border }} />}
          ListEmptyComponent={<EmptyState icon="receipt" message="No receipts attached yet." />}
          renderItem={({ item }: { item: ReceiptRow }) => <ReceiptItem item={item} theme={theme} />}
        />
      )}
    </View>
  );
}

function ReceiptItem({ item, theme }: { item: ReceiptRow; theme: AppTheme }) {
  const isImage = item.file_mime_type.startsWith('image/');
  return (
    <View style={styles.row}>
      <MaterialCommunityIcons
        name={isImage ? 'file-image-outline' : 'file-pdf-box'}
        size={22}
        color={theme.app.mutedForeground}
        style={{ marginRight: spacing.sm }}
      />
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.app.foreground, fontFamily: fontFamily.medium }} numberOfLines={1}>{item.file_name}</Text>
        <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }} numberOfLines={1}>
          {item.linked_label ?? 'Not linked'} · {fmtBytes(item.file_byte_size)} · {fmtShortDate(item.created_at)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
