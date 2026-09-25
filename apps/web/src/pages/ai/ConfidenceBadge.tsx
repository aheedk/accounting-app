import { CODING_LAYERS, type ConfidenceBand, type CodingLayerId } from '@accounting/shared';

export type SuggestionMeta = {
  confidence: number;
  band: ConfidenceBand;
  source_layer: CodingLayerId;
};

const BAND_STYLE: Record<ConfidenceBand, { className: string; emptyLabel: string }> = {
  auto_post:     { className: 'bg-emerald-100 text-emerald-800', emptyLabel: 'Auto-post' },
  preselected:   { className: 'bg-blue-100 text-blue-800',       emptyLabel: 'Preselected' },
  suggested:     { className: 'bg-amber-100 text-amber-900',     emptyLabel: 'Review' },
  unclassified:  { className: 'bg-muted text-muted-foreground',  emptyLabel: 'No suggestion' },
};

function layerLabel(id: CodingLayerId): string {
  return CODING_LAYERS.find(layer => layer.id === id)?.label ?? id;
}

export default function ConfidenceBadge({ suggestion }: { suggestion: SuggestionMeta | null | undefined }) {
  if (!suggestion) {
    return (
      <span
        className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground"
        title="No rule, vendor default, history, or AI match reached the confidence threshold."
      >
        No suggestion
      </span>
    );
  }

  const style = BAND_STYLE[suggestion.band];
  const label = layerLabel(suggestion.source_layer);
  const pct = `${suggestion.confidence}%`;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${style.className}`}
      title={`${label} · ${pct} confidence`}
    >
      <span>{label}</span>
      <span className="opacity-60">·</span>
      <span className="font-semibold">{pct}</span>
    </span>
  );
}
