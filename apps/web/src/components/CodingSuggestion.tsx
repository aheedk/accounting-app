import { CODING_LAYERS } from '@accounting/shared';

export type CodingSuggestion = { account_id: string; confidence: number; band: string; source_layer: string };

/** At 90 and up (a rule the client taught, a vendor default) a suggestion is filled in; below that it is only offered. */
export const PREFILL_CONFIDENCE = 90;

/**
 * The line under an account box saying what the auto-coding engine would pick,
 * where that came from and how sure it is, with a link to take it.
 */
export function CodingSuggestionHint({
  suggestion, accounts, selectedId, onUse,
}: {
  suggestion: CodingSuggestion | null;
  accounts: Array<{ id: string; name: string }>;
  selectedId: string;
  onUse: (accountId: string) => void;
}) {
  if (!suggestion) return null;
  return (
    <p className="mt-1 text-xs text-muted-foreground">
      {CODING_LAYERS.find(layer => layer.id === suggestion.source_layer)?.label ?? 'Suggested'}:{' '}
      <span className="font-medium text-foreground">
        {accounts.find(a => a.id === suggestion.account_id)?.name ?? 'an account'}
      </span>{' '}
      ({suggestion.confidence}%)
      {selectedId !== suggestion.account_id && (
        <>{' '}<button type="button" className="font-medium text-primary underline" onClick={() => onUse(suggestion.account_id)}>Use</button></>
      )}
    </p>
  );
}
