import { useCallback, useEffect, useState } from 'react';
import { Sparkles, Trash2 } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import AiSettingsCard from './AiSettingsCard';
import { Input } from '@/components/ui/input';

type RuleLine = {
  account_id: string;
  debit: string;
  credit: string;
  memo: string | null;
};

type CodingRule = {
  id: string;
  normalized_vendor: string;
  direction: 'debit' | 'credit';
  lines: RuleLine[];
  times_applied: number;
  times_corrected: number;
  last_applied_at: string | null;
  created_at: string;
  bank_account_name: string | null;
};

type Account = { id: string; code: string; name: string };

export default function CodingRulesPage() {
  const [bizId] = useActiveBusinessId();
  const [rules, setRules] = useState<CodingRule[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!bizId) return;
    setLoading(true);
    setError(null);
    try {
      const [ruleResponse, accountResponse] = await Promise.all([
        api.get<{ rules: CodingRule[] }>(`/businesses/${bizId}/ai/coding-rules`),
        api.get<{ accounts: Account[] }>(`/businesses/${bizId}/coa`),
      ]);
      setRules(ruleResponse.data.rules);
      setAccounts(accountResponse.data.accounts ?? []);
    } catch {
      setError('Could not load coding rules.');
    } finally {
      setLoading(false);
    }
  }, [bizId]);

  useEffect(() => { void load(); }, [load]);

  async function remove(rule: CodingRule) {
    if (!bizId) return;
    const previous = rules;
    setRules(current => current.filter(item => item.id !== rule.id));
    try {
      await api.delete(`/businesses/${bizId}/ai/coding-rules/${rule.id}`);
    } catch {
      setRules(previous);
      setError('Could not delete that rule.');
    }
  }

  function accountLabel(line: RuleLine) {
    const match = accounts.find(account => account.id === line.account_id);
    return match ? `${match.code} ${match.name}` : 'Unknown account';
  }

  const visible = rules.filter(rule =>
    rule.normalized_vendor.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Sparkles className="h-5 w-5 text-primary" />
            Coding Rules
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What this client&rsquo;s transactions have taught the system. A rule is created when you
            correct a suggestion, and is applied before any AI guess.
          </p>
        </div>
        <Input
          placeholder="Filter by vendor…"
          value={filter}
          onChange={event => setFilter(event.target.value)}
          className="w-64"
        />
      </div>

      <AiSettingsCard />

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-md border px-4 py-8 text-center text-sm text-muted-foreground">
          Loading…
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-md border px-4 py-10 text-center text-sm text-muted-foreground">
          {rules.length === 0
            ? 'No rules learned yet. Correct a suggested account in the Document Inbox and the choice is remembered here.'
            : 'No rules match that filter.'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Vendor</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Direction</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Posts to</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Bank account</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Applied</th>
                <th className="w-16 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {visible.map(rule => (
                <tr key={rule.id} className="border-b last:border-b-0 hover:bg-muted/20">
                  <td className="px-3 py-2 font-medium">{rule.normalized_vendor}</td>
                  <td className="px-3 py-2 capitalize text-muted-foreground">{rule.direction}</td>
                  <td className="px-3 py-2">
                    {rule.lines.map((line, index) => (
                      <div key={index}>{accountLabel(line)}</div>
                    ))}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {rule.bank_account_name ?? 'Any'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{rule.times_applied}</td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Delete rule for ${rule.normalized_vendor}`}
                      onClick={() => void remove(rule)}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
