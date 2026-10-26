import { useEffect, useState } from 'react';
import { CheckCircle } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { fmtMoney } from '@/lib/money';
import { pickErr } from '@/lib/apiErrors';
import { AppSelect } from '../../components/ui/select';
import ConfidenceBadge, { type SuggestionMeta } from '@/pages/ai/ConfidenceBadge';
import { StatementSummaryFields } from './StatementSummaryFields';
import { NO_SUMMARY, summaryFormOf, type SummaryForm } from '@/lib/statementSummary';
import { LoadingIndicator } from '@/components/ui/LoadingIndicator';

type ExtractedTx = {
  date: string;
  payee_name?: string;
  description: string;
  amount: string;
  type: 'deposit' | 'check' | 'expense' | 'debit' | 'credit';
  balance: string;
  check_number?: string;
  suggested_account_id?: string;
  suggestion?: SuggestionMeta | null;
};

type StagedImport = {
  id: string;
  status: string;
  statement_kind?: 'bank' | 'credit_card';
  account_hint?: string | null;
  extracted_transactions: ExtractedTx[];
  period_start?: string | null;
  period_end?: string | null;
  beginning_balance?: string | null;
  ending_balance?: string | null;
};

type CoaAccount = { id: string; code: string; name: string; account_type: string };

/**
 * The AI inbox's bank-statement review, trimmed down and mounted inline on
 * the Reconcile page instead of a separate page — upload, review, approve
 * without leaving Reconcile. Deliberately not a copy of the full
 * EmailImportReviewPage.tsx (1500+ lines, also handling credit-card-specific
 * flows, check-stub matching, "already recorded" duplicate detection, and
 * invoices) — that stays the one place for those. This covers only what a
 * plain bank/credit-card statement needs: the period/balance summary
 * (reusing the same StatementSummaryFields the inbox uses) and, per line, the
 * one thing approving genuinely cannot skip — a category account — since the
 * real approve endpoint posts a journal entry per included line and requires
 * one. Everything else about a line (its date, description, amount) is
 * display-only here, same as the task asked for.
 */
export function ReconcileStatementReview({
  stagingId, accountId, onApproved, onDiscard,
}: {
  stagingId: string;
  /** The account selected on the Reconcile setup form — used as the
   * statement's own account, so the user never picks it twice. */
  accountId: string;
  onApproved: (summary: { period_end: string | null; ending_balance: string | null; transactionCount: number }) => void;
  onDiscard: () => void;
}) {
  const [bizId] = useActiveBusinessId();
  const [imp, setImp] = useState<StagedImport | null>(null);
  const [accounts, setAccounts] = useState<CoaAccount[]>([]);
  const [summary, setSummary] = useState<SummaryForm>(NO_SUMMARY);
  const [offsets, setOffsets] = useState<Record<number, string>>({});
  const [included, setIncluded] = useState<Record<number, boolean>>({});
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [approveErr, setApproveErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!bizId) return;
    setLoadErr(null);
    setImp(null);
    api.get<{ import: StagedImport }>(`/businesses/${bizId}/email-imports/${stagingId}`)
      .then(r => {
        const row = r.data.import;
        setImp(row);
        setSummary(summaryFormOf(row));
        const initIncluded: Record<number, boolean> = {};
        const initOffsets: Record<number, string> = {};
        row.extracted_transactions.forEach((tx, i) => {
          initIncluded[i] = true;
          if (tx.suggested_account_id) initOffsets[i] = tx.suggested_account_id;
        });
        setIncluded(initIncluded);
        setOffsets(initOffsets);
      })
      .catch((e: unknown) => setLoadErr(pickErr(e)));
    api.get<{ accounts: CoaAccount[] }>(`/businesses/${bizId}/coa`).then(r => setAccounts(r.data.accounts)).catch(() => {});
  }, [bizId, stagingId]);

  async function approve() {
    if (!bizId || !imp) return;
    const missing = imp.extracted_transactions.findIndex((_, i) => (included[i] ?? true) && !offsets[i]);
    if (missing !== -1) { setApproveErr(`Select a category account for row ${missing + 1}.`); return; }
    if (summary.period_start && summary.period_end && summary.period_start > summary.period_end) {
      setApproveErr('The statement period ends before it starts.');
      return;
    }
    setBusy(true);
    setApproveErr(null);
    try {
      await api.post(`/businesses/${bizId}/email-imports/${imp.id}/approve`, {
        bank_account_id: accountId,
        transactions: imp.extracted_transactions.map((tx, i) => ({
          index: i,
          offset_account_id: offsets[i] ?? '',
          include: included[i] ?? true,
          remember: false,
          payee_name: tx.payee_name ?? '',
          check_stub_id: null,
        })),
        summary: {
          period_start: summary.period_start || null,
          period_end: summary.period_end || null,
          beginning_balance: summary.beginning_balance || null,
          ending_balance: summary.ending_balance || null,
        },
      });
      onApproved({ period_end: summary.period_end || null, ending_balance: summary.ending_balance || null, transactionCount: imp.extracted_transactions.length });
    } catch (e: unknown) {
      setApproveErr(pickErr(e));
    } finally {
      setBusy(false);
    }
  }

  if (loadErr) {
    return (
      <div className="space-y-2 rounded-lg border p-4">
        <p className="text-sm text-destructive">{loadErr}</p>
        <Button type="button" variant="ghost" size="sm" onClick={onDiscard}>Re-upload</Button>
      </div>
    );
  }
  if (!imp) return <div className="rounded-lg border p-4"><LoadingIndicator size="sm" /></div>;

  if (imp.statement_kind !== 'bank' && imp.statement_kind !== 'credit_card') {
    return (
      <div className="space-y-2 rounded-lg border p-4">
        <p className="text-sm text-destructive">This doesn't look like a bank statement. Try a different file.</p>
        <Button type="button" variant="ghost" size="sm" onClick={onDiscard}>Re-upload</Button>
      </div>
    );
  }

  const kind = imp.statement_kind;
  const lines = imp.extracted_transactions.map(tx => ({ date: tx.date, amount: tx.amount, type: tx.type }));

  return (
    <div className="space-y-3 rounded-lg border p-4">
      {imp.account_hint && (
        <p className="text-xs text-muted-foreground">Statement for: <span className="font-medium text-foreground">{imp.account_hint}</span></p>
      )}

      <StatementSummaryFields kind={kind} lines={lines} value={summary} onChange={setSummary} />

      {imp.extracted_transactions.length === 0 && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          No transactions were read from this statement. You can still approve it (for instance to just set the balances),
          but check the PDF — this usually means the parse missed something.
        </p>
      )}

      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">
          {imp.extracted_transactions.length} transaction{imp.extracted_transactions.length === 1 ? '' : 's'} found
        </p>
        <div className="max-h-[300px] overflow-y-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 border-b bg-muted/60">
              <tr>
                <th className="p-2 text-left">Date</th>
                <th className="p-2 text-left">Description</th>
                <th className="p-2 text-right">Amount</th>
                <th className="p-2 text-right">Balance</th>
                <th className="p-2 text-left">Category</th>
                <th className="p-2 text-center">Include</th>
              </tr>
            </thead>
            <tbody>
              {imp.extracted_transactions.map((tx, i) => (
                <tr key={i} className="border-b last:border-b-0">
                  <td className="p-2 whitespace-nowrap">{tx.date}</td>
                  <td className="p-2">{tx.description}</td>
                  <td className="p-2 text-right font-mono">{fmtMoney(tx.amount)}</td>
                  <td className="p-2 text-right font-mono">{tx.balance ? fmtMoney(tx.balance) : ''}</td>
                  <td className="p-2">
                    <AppSelect
                      disabled={!(included[i] ?? true)}
                      className={`h-7 w-full max-w-[200px] rounded border bg-background px-1.5 text-xs disabled:opacity-40 ${offsets[i] ? 'border-emerald-400' : ''}`}
                      value={offsets[i] ?? ''}
                      onChange={e => setOffsets(prev => ({ ...prev, [i]: e.target.value }))}
                    >
                      <option value="">— select account —</option>
                      {accounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                    </AppSelect>
                    <div className="mt-0.5"><ConfidenceBadge suggestion={tx.suggestion} /></div>
                  </td>
                  <td className="p-2 text-center">
                    <input
                      type="checkbox"
                      checked={included[i] ?? true}
                      onChange={e => setIncluded(prev => ({ ...prev, [i]: e.target.checked }))}
                      className="h-4 w-4"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {approveErr && <p className="text-sm text-destructive">{approveErr}</p>}

      <div className="flex items-center gap-2">
        <Button type="button" disabled={busy} onClick={() => void approve()}>
          {busy ? <span className="inline-flex items-center gap-2"><LoadingIndicator size="sm" /> Applying…</span> : (
            <span className="inline-flex items-center gap-1.5"><CheckCircle className="h-4 w-4" /> Looks good — use this statement</span>
          )}
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={onDiscard}>Re-upload</Button>
      </div>
    </div>
  );
}
