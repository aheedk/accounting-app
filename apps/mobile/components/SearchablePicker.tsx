import { useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Modal, Portal, Text, useTheme } from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import { Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AppTextInput } from './ui/AppTextInput';
import { spacing, typeScale, minTouchTarget, type AppTheme } from '../theme';

export type PickerOption = { id: string; label: string; sublabel?: string };

/**
 * A full-screen-ish modal search list — the one searchable dropdown every
 * create/edit form (payee, payment account, category) uses, so picking an
 * account stays snappy even with hundreds of accounts: everything is
 * filtered in memory against an already-loaded list (no network round trip
 * per keystroke), rendered through FlashList rather than a long ScrollView.
 */
export function SearchablePicker({
  visible, onDismiss, title, options, onSelect, placeholder = 'Search…',
  footer,
}: {
  visible: boolean;
  onDismiss: () => void;
  title: string;
  options: PickerOption[];
  onSelect: (id: string) => void;
  placeholder?: string;
  /** e.g. a "+ Add new vendor" row rendered under the filtered results. */
  footer?: React.ReactNode;
}) {
  const theme = useTheme<AppTheme>();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => o.label.toLowerCase().includes(q) || (o.sublabel ?? '').toLowerCase().includes(q));
  }, [options, query]);

  return (
    <Portal>
      <Modal visible={visible} onDismiss={onDismiss} contentContainerStyle={[styles.sheet, { backgroundColor: theme.app.surface }]}>
        <Text style={{ fontSize: typeScale.h2, fontWeight: '700', color: theme.app.foreground, marginBottom: spacing.sm }}>{title}</Text>
        <AppTextInput
          placeholder={placeholder}
          value={query}
          onChangeText={setQuery}
          autoFocus
          containerStyle={{ marginBottom: spacing.sm }}
          left={<MaterialCommunityIcons name="magnify" size={18} color={theme.app.mutedForeground} />}
        />
        <View style={styles.list}>
          <FlashList
            data={filtered}
            keyExtractor={o => o.id}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <Text style={{ color: theme.app.mutedForeground, textAlign: 'center', paddingVertical: spacing.lg }}>No matches.</Text>
            }
            ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.app.border }} />}
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [styles.row, { minHeight: minTouchTarget, opacity: pressed ? 0.6 : 1 }]}
                onPress={() => { onSelect(item.id); onDismiss(); }}
              >
                <Text style={{ color: theme.app.foreground, fontWeight: '600' }} numberOfLines={1}>{item.label}</Text>
                {item.sublabel ? (
                  <Text style={{ color: theme.app.mutedForeground, fontSize: typeScale.caption }} numberOfLines={1}>{item.sublabel}</Text>
                ) : null}
              </Pressable>
            )}
          />
        </View>
        {footer}
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  sheet: { margin: spacing.lg, borderRadius: 16, padding: spacing.lg, maxHeight: '80%', minHeight: '50%' },
  list: { flex: 1 },
  row: { justifyContent: 'center', paddingVertical: spacing.sm },
});
