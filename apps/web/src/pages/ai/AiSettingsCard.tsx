import { useCallback, useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { MoneyInput } from '@/components/ui/money-input';

type Business = { id: string; name: string; ai_auto_post_enabled?: boolean; capitalization_threshold?: string };

/**
 * Auto-post opt-in. Off by default and per client, because posting to the
 * ledger without a human reviewing each line is a firm policy decision.
 */
export default function AiSettingsCard({ onChange }: { onChange?: (enabled: boolean) => void }) {
  const [bizId] = useActiveBusinessId();
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allowed, setAllowed] = useState(true);
  // Invoice lines at or above this are coded to a fixed asset instead of an expense.
  const [threshold, setThreshold] = useState('');
  const [savedThreshold, setSavedThreshold] = useState('');

  const load = useCallback(async () => {
    if (!bizId) return;
    try {
      const response = await api.get<Business>(`/businesses/${bizId}`);
      setEnabled(response.data.ai_auto_post_enabled === true);
      onChange?.(response.data.ai_auto_post_enabled === true);
      const current = Number(response.data.capitalization_threshold ?? 0).toFixed(2);
      setThreshold(current);
      setSavedThreshold(current);
    } catch {
      setError('Could not read the auto-post setting.');
    }
  }, [bizId, onChange]);

  useEffect(() => { void load(); }, [load]);

  async function toggle(next: boolean) {
    if (!bizId || busy) return;
    setBusy(true);
    setError(null);
    const previous = enabled;
    setEnabled(next);
    try {
      await api.patch(`/businesses/${bizId}`, { ai_auto_post_enabled: next });
      onChange?.(next);
    } catch (e: unknown) {
      setEnabled(previous);
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 403) {
        setAllowed(false);
        setError('Only a firm admin can change this setting.');
      } else {
        setError('Could not save the setting.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveThreshold() {
    if (!bizId || busy || threshold === '' || Number(threshold) === Number(savedThreshold)) return;
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/businesses/${bizId}`, { capitalization_threshold: Number(threshold) });
      setSavedThreshold(threshold);
    } catch (e: unknown) {
      setThreshold(savedThreshold);
      const status = (e as { response?: { status?: number } })?.response?.status;
      setError(status === 403 ? 'Only a firm admin can change this setting.' : 'Could not save the setting.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border p-4">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4"
          checked={enabled}
          disabled={busy || !allowed}
          onChange={event => void toggle(event.target.checked)}
        />
        <div className="space-y-1">
          <div className="text-sm font-medium">
            Auto-post high-confidence transactions
          </div>
          <p className="max-w-2xl text-xs text-muted-foreground">
            Off by default. When on, opening a statement and choosing its bank account posts the
            rows the system is confident about (98+) straight to the ledger, leaving only
            exceptions to review. Today that means vendors you have already corrected once.
            Everything below 98 always waits for you.
          </p>
          {enabled && (
            <p className="flex items-start gap-1.5 pt-1 text-xs text-amber-700">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Journal entries will be created without line-by-line review. They are reversible,
              and every one is recorded in the audit log.
            </p>
          )}
        </div>
      </label>
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t pt-4">
        <label htmlFor="capitalization-threshold" className="text-sm font-medium">Capitalize purchases of at least</label>
        <MoneyInput
          id="capitalization-threshold"
          className="h-9 w-32 text-right font-mono"
          value={threshold}
          onChange={event => setThreshold(event.target.value)}
          onBlur={() => { void saveThreshold(); }}
          disabled={busy || !allowed}
        />
        <p className="basis-full text-xs text-muted-foreground">
          An invoice line at or above this amount is coded to a fixed asset instead of an expense. Saved when you leave the box.
        </p>
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}
