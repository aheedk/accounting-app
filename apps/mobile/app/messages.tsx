import { useEffect, useState } from 'react';
import { View, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../hooks/useAuth';
import { AppHeader } from '../components/AppHeader';
import { AppButton } from '../components/ui/AppButton';
import { AppTextInput } from '../components/ui/AppTextInput';
import { listMessages, postMessage, markMessagesRead, type MessageRow } from '../services/api';
import { pickErr } from '../services/apiClient';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { spacing, typeScale, fontFamily, type AppTheme } from '../theme';

// One thread per company, not per conversation — matches web's MessagesPage
// (a single company-to-firm channel). Polls every 30s like web; no
// websocket infra exists in this app to do better.
export default function MessagesScreen() {
  const theme = useTheme<AppTheme>();
  const insets = useSafeAreaInsets();
  const { activeBusinessId, user } = useAuth();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSend = user?.role !== 'viewer';

  const query = useQuery({
    queryKey: ['messages', activeBusinessId],
    queryFn: () => listMessages(activeBusinessId!, { limit: 50 }),
    enabled: !!activeBusinessId,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (activeBusinessId && query.data) {
      void markMessagesRead(activeBusinessId);
    }
  }, [activeBusinessId, query.data]);

  async function handleSend() {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    setError(null);
    try {
      await postMessage(activeBusinessId!, body);
      setDraft('');
      await queryClient.invalidateQueries({ queryKey: ['messages', activeBusinessId] });
    } catch (e) {
      setError(pickErr(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <AppHeader title="Messages" />

      {query.isLoading ? (
        <LoadingIndicator />
      ) : query.error || !query.data ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : query.data.messages.length === 0 ? (
        <View style={{ flex: 1 }}>
          <EmptyState icon="message-text-outline" message="No messages yet." />
        </View>
      ) : (
        <FlashList
          data={query.data.messages}
          keyExtractor={m => m.id}
          contentContainerStyle={{ padding: spacing.md }}
          renderItem={({ item }: { item: MessageRow }) => <MessageBubble message={item} theme={theme} />}
        />
      )}

      {canSend ? (
        <View style={[styles.composer, { borderColor: theme.app.border, backgroundColor: theme.app.surface, paddingBottom: insets.bottom + spacing.sm }]}>
          {error ? <Text style={{ color: theme.app.destructive, fontSize: typeScale.caption, marginBottom: spacing.xs }}>{error}</Text> : null}
          <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' }}>
            <AppTextInput
              value={draft} onChangeText={setDraft} placeholder="Message…" multiline
              containerStyle={{ flex: 1 }} style={{ maxHeight: 100 }}
            />
            <AppButton onPress={() => void handleSend()} loading={sending} disabled={!draft.trim()}>Send</AppButton>
          </View>
        </View>
      ) : (
        <View style={[styles.composer, { borderColor: theme.app.border, backgroundColor: theme.app.surface, paddingBottom: insets.bottom + spacing.sm }]}>
          <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption, textAlign: 'center' }}>
            A view-only login can't send messages.
          </Text>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

function MessageBubble({ message, theme }: { message: MessageRow; theme: AppTheme }) {
  const time = new Date(message.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return (
    <View style={{ alignItems: message.mine ? 'flex-end' : 'flex-start', marginBottom: spacing.sm }}>
      <View
        style={[
          styles.bubble,
          { backgroundColor: message.mine ? theme.app.primary : theme.app.muted },
        ]}
      >
        {!message.mine ? (
          <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption, fontFamily: fontFamily.semibold, marginBottom: 2 }}>
            {message.author_name}
          </Text>
        ) : null}
        <Text style={{ color: message.mine ? theme.app.primaryForeground : theme.app.foreground }}>{message.body}</Text>
      </View>
      <Text style={{ color: theme.app.mutedForeground, fontSize: 10, marginTop: 2 }}>{time}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: { maxWidth: '80%', borderRadius: 12, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  composer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
});
