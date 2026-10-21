import { View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { CODING_LAYERS, type ConfidenceBand, type CodingLayerId } from '@accounting/shared';
import type { AppTheme } from '../theme';

// Direct port of apps/web/src/pages/ai/ConfidenceBadge.tsx — same band
// colors/labels/thresholds (from @accounting/shared, not re-derived here),
// so the mobile reviewer sees the exact same signal the web page shows.

export type SuggestionMeta = { confidence: number; band: ConfidenceBand; source_layer: CodingLayerId } | null | undefined;

const BAND_COLORS: Record<ConfidenceBand, { bg: string; fg: string }> = {
  auto_post: { bg: '#d1fae5', fg: '#065f46' },
  preselected: { bg: '#dbeafe', fg: '#1e40af' },
  suggested: { bg: '#fef3c7', fg: '#78350f' },
  unclassified: { bg: '#f1f3f4', fg: '#5e6368' },
};

function layerLabel(id: CodingLayerId): string {
  return CODING_LAYERS.find(layer => layer.id === id)?.label ?? id;
}

export function ConfidenceBadge({ suggestion }: { suggestion: SuggestionMeta }) {
  const theme = useTheme<AppTheme>();

  if (!suggestion) {
    return <Badge bg={theme.app.statusGrayBg} fg={theme.app.statusGrayFg} text="No suggestion" />;
  }
  if (suggestion.source_layer === 'suspense') {
    return <Badge bg="#fef3c7" fg="#78350f" text="Suspense · not sure" />;
  }
  const colors = BAND_COLORS[suggestion.band];
  return <Badge bg={colors.bg} fg={colors.fg} text={`${layerLabel(suggestion.source_layer)} · ${suggestion.confidence}%`} />;
}

function Badge({ bg, fg, text }: { bg: string; fg: string; text: string }) {
  return (
    <View style={{ backgroundColor: bg, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10, alignSelf: 'flex-start' }}>
      <Text style={{ color: fg, fontSize: 10, fontWeight: '600' }}>{text}</Text>
    </View>
  );
}
