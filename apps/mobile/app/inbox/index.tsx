import { View, StyleSheet, RefreshControl, Pressable } from 'react-native';
import { Text, Appbar, useTheme } from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../hooks/useAuth';
import { listEmailImports, type StagedImportRow } from '../../services/api';
import { deriveImportTitle, deriveImportSubtitle, deriveImportStatus } from '../../lib/emailImportLabel';
import { LoadingIndicator } from '../../components/LoadingIndicator';
import { ErrorState } from '../../components/ErrorState';
import { CameraCaptureButton } from '../../components/CameraCaptureButton';
import { spacing, typeScale, minTouchTarget, type AppTheme } from '../../theme';

const STATUS_LABELS: Record<ReturnType<typeof deriveImportStatus>, string> = {
  pending: 'Pending review', partially_reviewed: 'Partially reviewed',
  approved: 'Approved', rejected: 'Rejected',
};

export default function InboxScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { activeBusinessId } = useAuth();

  const query = useQuery({
    queryKey: ['email-imports', activeBusinessId],
    queryFn: () => listEmailImports(activeBusinessId!),
    enabled: !!activeBusinessId,
  });

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Appbar.Header statusBarHeight={insets.top} style={{ backgroundColor: theme.app.surface }}>
        <Appbar.BackAction onPress={() => router.back()} color={theme.app.foreground} />
        <Appbar.Content title="AI Document Inbox" titleStyle={{ color: theme.app.foreground }} />
        <CameraCaptureButton />
      </Appbar.Header>

      {query.isLoading ? (
        <LoadingIndicator />
      ) : query.error ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <FlashList
          data={query.data ?? []}
          keyExtractor={(row: StagedImportRow) => row.id}
          contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + spacing.xxl }}
          refreshControl={<RefreshControl refreshing={query.isFetching && !query.isLoading} onRefresh={() => void query.refetch()} tintColor={theme.app.primary} />}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={{ color: theme.app.mutedForeground }}>No pending reviews.</Text>
            </View>
          }
          renderItem={({ item }: { item: StagedImportRow }) => {
            const status = deriveImportStatus(item);
            return (
              <Pressable
                style={({ pressed }) => [
                  styles.card, { minHeight: minTouchTarget + 24, borderColor: theme.app.border, backgroundColor: theme.app.surface, opacity: pressed ? 0.6 : 1 },
                ]}
                onPress={() => router.push({ pathname: '/inbox/[id]', params: { id: item.id } })}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.app.foreground, fontWeight: '700' }} numberOfLines={1}>{deriveImportTitle(item)}</Text>
                  <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption, marginTop: 2 }} numberOfLines={1}>
                    {deriveImportSubtitle(item)}
                  </Text>
                </View>
                <StatusPill status={status} theme={theme} />
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

function StatusPill({ status, theme }: { status: ReturnType<typeof deriveImportStatus>; theme: AppTheme }) {
  const map: Record<string, { bg: string; fg: string }> = {
    pending: { bg: theme.app.statusGrayBg, fg: theme.app.statusGrayFg },
    partially_reviewed: { bg: theme.app.statusBlueBg, fg: theme.app.statusBlueFg },
    approved: { bg: theme.app.statusGreenBg, fg: theme.app.statusGreenFg },
    rejected: { bg: theme.app.statusRedBg, fg: theme.app.statusRedFg },
  };
  const c = map[status] ?? map.pending!;
  return (
    <View style={{ backgroundColor: c.bg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, marginLeft: spacing.sm }}>
      <Text style={{ color: c.fg, fontSize: 10, fontWeight: '600' }}>{STATUS_LABELS[status]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderWidth: 1, borderRadius: 12 },
  empty: { alignItems: 'center', paddingTop: spacing.xxl },
});
