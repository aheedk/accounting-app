import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Copy, Paperclip, Trash2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DateInput } from '@/components/ui/date-input';
import { AccountSelect } from '@/components/ui/AccountSelect';
import { fmtMoney } from '@/lib/money';
import { todayLocal } from '@/lib/dates';
import { pickErr } from '@/lib/apiErrors';
import {
  blankJournalLine,
  journalAccountsForLine,
  journalEntryPayload,
  journalEntryToForm,
  journalEntryTotals,
  newJournalEntryForm,
  type JournalEntryFormLine,
  type JournalEntryFormValues,
  type JournalAccount,
} from './journalEntryForm';
import type { JournalEntryDetail } from './journalEntryTypes';
import {
  JOURNAL_CLOSE_PATH,
  journalDestinationPath,
  type JournalSaveDestination,
} from './journalNavigation';

type JournalEntryEditorProps = {
  existing?: JournalEntryDetail;
};

export default function JournalEntryEditor({ existing }: JournalEntryEditorProps) {
  const [businessId] = useActiveBusinessId();
  const [accounts, setAccounts] = useState<JournalAccount[]>([]);
  const [form, setForm] = useState<JournalEntryFormValues>(() => (
    existing ? journalEntryToForm(existing) : newJournalEntryForm(todayLocal())
  ));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [primarySaveAction, setPrimarySaveAction] = useState<'new' | 'close'>(
    () => (localStorage.getItem('je_primarySaveAction') === 'close' ? 'close' : 'new'),
  );
  const [showSaveMenu, setShowSaveMenu] = useState(false);
  const saveMenuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const readOnly = existing !== undefined && !existing.can_correct;
  const totals = journalEntryTotals(form.lines);
  const filledLineCount = form.lines.filter(line => line.account_id).length;
  const canSave = !readOnly && totals.balanced && filledLineCount >= 2 && !busy;

  useEffect(() => {
    if (!businessId) return;
    api.get<{ accounts: JournalAccount[] }>(`/businesses/${businessId}/coa`, {
      params: { include_inactive: 'true' },
    }).then(response => setAccounts(response.data.accounts));
  }, [businessId]);

  useEffect(() => {
    function handle(event: MouseEvent) {
      if (saveMenuRef.current && !saveMenuRef.current.contains(event.target as Node)) {
        setShowSaveMenu(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  function updateForm(patch: Partial<Omit<JournalEntryFormValues, 'lines'>>) {
    setForm(current => ({ ...current, ...patch }));
  }

  function updateLine(index: number, patch: Partial<JournalEntryFormLine>) {
    setForm(current => ({
      ...current,
      lines: current.lines.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line),
    }));
  }

  function copyLine(index: number) {
    setForm(current => {
      const source = current.lines[index];
      if (!source) return current;
      const lines = [...current.lines];
      lines.splice(index + 1, 0, { ...source });
      return { ...current, lines };
    });
  }

  function removeLine(index: number) {
    setForm(current => ({ ...current, lines: current.lines.filter((_, lineIndex) => lineIndex !== index) }));
  }

  function clearLines() {
    setForm(current => ({ ...current, lines: Array.from({ length: 8 }, blankJournalLine) }));
  }

  async function save(destination: JournalSaveDestination = 'detail') {
    if (!businessId || !canSave) return;
    setError(null);
    setBusy(true);
    try {
      const body = journalEntryPayload(form);
      let savedId: string;
      if (existing) {
        const response = await api.post<{ corrected_entry: { id: string } }>(
          `/businesses/${businessId}/journal-entries/${existing.entry.id}/correct`,
          body,
        );
        savedId = response.data.corrected_entry.id;
      } else {
        const response = await api.post<{ id: string }>(`/businesses/${businessId}/journal-entries`, body);
        savedId = response.data.id;
      }

      if (destination === 'new') {
        if (existing) navigate(journalDestinationPath(destination, savedId));
        else setForm(newJournalEntryForm(todayLocal()));
      } else {
        navigate(journalDestinationPath(destination, savedId));
      }
    } catch (requestError: unknown) {
      setError(pickErr(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function voidEntry() {
    if (!businessId || !existing?.can_correct) return;
    const reason = window.prompt('Reason for voiding?');
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/businesses/${businessId}/journal-entries/${existing.entry.id}/void`, {
        void_reason: reason,
      });
      navigate(JOURNAL_CLOSE_PATH);
    } catch (requestError: unknown) {
      setError(pickErr(requestError));
    } finally {
      setBusy(false);
    }
  }

  if (!businessId) return <div>Pick a business.</div>;

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col -mx-6 -my-6">
      <div className="flex flex-wrap items-center gap-3 border-b bg-background px-6 py-4">
        <h1 className="text-xl font-semibold">
          Journal Entry{form.journalNo ? ` #${form.journalNo}` : ''}
        </h1>
        {existing && (
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
            existing.entry.status === 'posted'
              ? 'bg-emerald-100 text-emerald-800'
              : 'bg-muted text-muted-foreground'
          }`}>
            {existing.entry.status}
          </span>
        )}
        <div className="ml-auto flex flex-wrap gap-3 text-xs text-muted-foreground">
          {existing?.entry.corrected_from_entry_id && (
            <Link className="text-primary hover:underline" to={`/journal/${existing.entry.corrected_from_entry_id}`}>
              Correction of JE {existing.entry.corrected_from_entry_id.slice(0, 8)}
            </Link>
          )}
          {existing?.entry.reversed_entry_id && (
            <Link className="text-primary hover:underline" to={`/journal/${existing.entry.reversed_entry_id}`}>
              Reversal of JE {existing.entry.reversed_entry_id.slice(0, 8)}
            </Link>
          )}
        </div>
      </div>

      {existing && (
        <div className={`mx-6 mt-4 rounded-md border px-4 py-3 text-sm ${
          readOnly
            ? 'border-border bg-muted/40 text-muted-foreground'
            : 'border-amber-200 bg-amber-50 text-amber-900'
        }`}>
          {readOnly
            ? existing.correction_block_reason
            : 'Saving creates a reversing entry and posts the corrected replacement so your audit history stays intact.'}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-8 border-b bg-muted/10 px-6 pb-4 pt-5">
        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Journal date
          </label>
          <DateInput
            value={form.date}
            onChange={event => updateForm({ date: event.target.value })}
            required
            disabled={readOnly}
            className="w-44"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Journal no.
          </label>
          <Input
            value={form.journalNo}
            onChange={event => updateForm({ journalNo: event.target.value })}
            placeholder="e.g. AJE3"
            disabled={readOnly}
            className="w-44"
          />
        </div>
        <label className="flex items-center gap-2 pb-0.5 text-sm text-muted-foreground">
          <span>Is Adjusting Journal Entry?</span>
          <input
            type="checkbox"
            checked={form.isAdjusting}
            onChange={event => updateForm({ isAdjusting: event.target.checked })}
            disabled={readOnly}
            className="h-4 w-4 cursor-pointer rounded border-input disabled:cursor-not-allowed"
          />
        </label>
      </div>

      <div className="flex-1 overflow-auto px-6 py-4">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-t">
                <th className="w-8 px-2 py-2.5 text-left text-xs font-semibold text-muted-foreground">#</th>
                <th className="min-w-[180px] px-2 py-2.5 text-left text-xs font-semibold text-muted-foreground">ACCOUNT</th>
                <th className="w-32 px-2 py-2.5 text-right text-xs font-semibold text-muted-foreground">DEBITS</th>
                <th className="w-32 px-2 py-2.5 text-right text-xs font-semibold text-muted-foreground">CREDITS</th>
                <th className="min-w-[160px] px-2 py-2.5 text-left text-xs font-semibold text-muted-foreground">DESCRIPTION</th>
                <th className="w-36 px-2 py-2.5 text-left text-xs font-semibold text-muted-foreground">NAME</th>
                <th className="w-28 px-2 py-2.5 text-left text-xs font-semibold text-muted-foreground">CLASS</th>
                <th className="w-14 px-2 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {form.lines.map((line, index) => (
                <tr key={index} className="group border-b transition-colors hover:bg-muted/40">
                  <td className="px-2 py-1.5 text-xs text-muted-foreground">{index + 1}</td>
                  <td className="px-2 py-1.5">
                    <AccountSelect
                      accounts={journalAccountsForLine(accounts, line.account_id)}
                      value={line.account_id}
                      onChange={accountId => updateLine(index, { account_id: accountId })}
                      placeholder=""
                      disabled={readOnly}
                      className="w-full"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={line.debit}
                      onChange={event => updateLine(index, { debit: event.target.value, credit: '' })}
                      placeholder="0.00"
                      disabled={readOnly}
                      className="w-full text-right font-mono"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={line.credit}
                      onChange={event => updateLine(index, { credit: event.target.value, debit: '' })}
                      placeholder="0.00"
                      disabled={readOnly}
                      className="w-full text-right font-mono"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input
                      value={line.description}
                      onChange={event => updateLine(index, { description: event.target.value })}
                      disabled={readOnly}
                      className="w-full"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input
                      value={line.name}
                      onChange={event => updateLine(index, { name: event.target.value })}
                      disabled={readOnly}
                      className="w-full"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input
                      value={line.class_name}
                      onChange={event => updateLine(index, { class_name: event.target.value })}
                      disabled={readOnly}
                      className="w-full"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    {!readOnly && (
                      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => copyLine(index)}
                          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                          aria-label="Copy line"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeLine(index)}
                          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                          aria-label="Delete line"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              <tr className="border-t bg-muted/30">
                <td className="px-2 py-2.5" />
                <td className="px-2 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Total
                </td>
                <td className="px-2 py-2.5 text-right font-mono font-semibold">{fmtMoney(totals.debit)}</td>
                <td className="px-2 py-2.5 text-right font-mono font-semibold">{fmtMoney(totals.credit)}</td>
                <td colSpan={4} className="px-2 py-2.5">
                  {filledLineCount > 0 && (
                    <span className={`text-xs font-semibold ${totals.balanced ? 'text-emerald-600' : 'text-destructive'}`}>
                      {totals.balanced ? '✓ Balanced' : '✕ Unbalanced'}
                    </span>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {!readOnly && (
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={() => setForm(current => ({
                ...current,
                lines: [...current.lines, blankJournalLine(), blankJournalLine(), blankJournalLine()],
              }))}
              className="rounded border px-3 py-1.5 text-sm transition-colors hover:bg-muted/50"
            >
              Add lines
            </button>
            <button
              type="button"
              onClick={clearLines}
              className="rounded border px-3 py-1.5 text-sm transition-colors hover:bg-muted/50"
            >
              Clear all lines
            </button>
          </div>
        )}

        <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm font-medium">Memo</label>
            <textarea
              value={form.memo}
              onChange={event => updateForm({ memo: event.target.value })}
              rows={4}
              disabled={readOnly}
              className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium">Attachments</label>
            <div className="flex h-[108px] flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:bg-muted/20">
              <Paperclip className="h-5 w-5" />
              <span>Add attachment</span>
              <span className="text-xs">Max file size: 20 MB</span>
            </div>
          </div>
        </div>
      </div>

      {error && <p className="px-6 pb-2 text-sm text-destructive">{error}</p>}

      <div className="sticky bottom-0 flex items-center gap-3 border-t bg-background px-6 py-3">
        <Button type="button" variant="outline" onClick={() => navigate(JOURNAL_CLOSE_PATH)}>
          {readOnly ? 'Back' : 'Cancel'}
        </Button>
        {existing?.can_correct && (
          <Button type="button" variant="destructive" onClick={() => { void voidEntry(); }} disabled={busy}>
            Void entry
          </Button>
        )}

        {!readOnly && (
          <button type="button" className="mx-auto text-sm font-medium text-emerald-600 hover:underline">
            Make recurring
          </button>
        )}

        {!readOnly && (
          <div className="ml-auto flex items-center gap-2">
            <Button type="button" disabled={!canSave} onClick={() => { void save('detail'); }}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
            <div className="relative flex" ref={saveMenuRef}>
              <Button
                type="button"
                disabled={!canSave}
                onClick={() => { void save(primarySaveAction); }}
                className="rounded-r-none"
              >
                {busy ? 'Saving…' : primarySaveAction === 'new' ? 'Save and new' : 'Save and close'}
              </Button>
              <Button
                type="button"
                disabled={!canSave}
                aria-label="Save destination menu"
                onClick={() => setShowSaveMenu(current => !current)}
                className="rounded-l-none border-l border-l-primary-foreground/30 px-2"
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
              {showSaveMenu && (
                <div className="absolute bottom-full right-0 z-50 mb-1 w-44 rounded-md border bg-background py-1 shadow-lg">
                  <button
                    type="button"
                    className="w-full px-4 py-2.5 text-left text-sm hover:bg-accent"
                    onClick={() => {
                      const next = primarySaveAction === 'new' ? 'close' : 'new';
                      setPrimarySaveAction(next);
                      localStorage.setItem('je_primarySaveAction', next);
                      setShowSaveMenu(false);
                      void save(next);
                    }}
                  >
                    {primarySaveAction === 'new' ? 'Save and close' : 'Save and new'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
