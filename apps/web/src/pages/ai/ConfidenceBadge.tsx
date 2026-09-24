import { CODING_LAYERS, type ConfidenceBand, type CodingLayerId } from '@accounting/shared';

export type SuggestionMeta = {
  confidence: number;
  band: ConfidenceBand;
  source_layer: CodingLayerId;
};

const BAND_STYLE: Record<ConfidenceBand, { className: string; label: string }> = {
  auto_post: { className: 'bg-emerald-100 text-emerald-800', label: 'Auto-post' },
  preselected: { className: 'bg-blue-100 text-blue-800', label: 'Preselected' },
  suggested: { className: 'bg-amber-100 text-amber-900', label: 'Review' },
  unclassified: { className: 'bg-muted text-muted-foreground', label: 'Unclassified' },
};

function layerLabel(id: CodingLayerId): string {
  return CODING_LAYERS.find(layer => layer.id === id)?.label ?? id;
}

/**
 * Explains where a suggested account came from and how far the system trusts
 * it. `null` means no layer could classify the row.
 */
export default function ConfidenceBadge({ suggestion }: { suggestion: SuggestionMeta | null | undefined }) {
  if (!suggestion) {
    const style = BAND_STYLE.unclassified;
    return (
      <span
        className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${style.className}`}
        title="No rule, vendor default, history, or AI match reached the confidence threshold."
      >
        {style.label}
      </span>
    );
  }

  const style = BAND_STYLE[suggestion.band];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${style.className}`}
      title={`${layerLabel(suggestion.source_layer)} · confidence ${suggestion.confidence}`}
    >
      <span>{layerLabel(suggestion.source_layer)}</span>
      <span className="opacity-70">{suggestion.confidence}</span>
    </span>
  );
}
