import { useEffect, useRef, useState } from 'react';
import { BookOpen, ChevronDown, Clock, Copy, GripVertical, RotateCcw, Trash2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { DateInput } from '@/components/ui/date-input';
import { ComboInput } from '@/components/ui/ComboInput';
import { AccountSelect } from '@/components/ui/AccountSelect';
import { AuditHistoryModal } from '@/components/AuditHistoryModal';
import { fmtMoney } from '@/lib/money';
import { todayLocal } from '@/lib/dates';
import { pickErr } from '@/lib/apiErrors';
import {
  blankJournalLine,
  applyJournalNumberSuggestion,
  copyJournalEntryToForm,
  copyUnsavedJournalEntry,
  journalAccountsForLine,
  journalEntryPayload,
  journalSupportsManualActions,
  pickJournalLineAccount,
  journalEntryToForm,
  journalEntryTotals,
  newJournalEntryForm,
  shouldAppendJournalLines,
  MIN_BLANK_ROWS,
  type JournalEntryFormLine,
  type JournalEntryFormValues,
  type JournalAccount,
} from './journalEntryForm';
import type { JournalEntryDetail } from './journalEntryTypes';
import RecentJournalEntries from './RecentJournalEntries';
import JournalRecurringDialog from './JournalRecurringDialog';
import AccountCreateDrawer from '@/pages/coa/AccountCreateDrawer';
import { AttachmentsPanel, useAttachments } from '@/components/Attachments';
import { PostErrorNotice, type SaveWarningState } from '@/components/SaveAndPost';
import { JournalNumberRequestGate } from './journalNumberPreview';
import {
  JOURNAL_CLOSE_PATH,
  journalDestinationPath,
  type JournalSaveDestination,
} from './journalNavigation';

type JournalEntryEditorProps = {
  existing?: JournalEntryDetail;
  copySource?: JournalEntryDetail;
};

type FiscalPeriod = {
  id: string;
  starts_on: string;
  ends_on: string;
  status: 'open' | 'closed';
};

function fmtJournalDate(iso: string) {
  const [year, month, day] = iso.split('-');
  if (!year || !month || !day) return iso;
  return `${Number(month)}/${Number(day)}/${year}`;
}

export default function JournalEntryEditor({ existing, copySource }: JournalEntryEditorProps) {
  const [businessId] = useActiveBusinessId();
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<JournalAccount[]>([]);
  // The client's cost centers (Setup > Cost Centers), offered in the Class column.
  const [costCenters, setCostCenters] = useState<string[]>([]);
  useEffect(() => {
    if (!businessId) return;
    api.get<{ cost_centers: Array<{ name: string; is_active: boolean }> }>(`/businesses/${businessId}/cost-centers`)
      .then(r => setCostCenters(r.data.cost_centers.filter(c => c.is_active).map(c => c.name)))
      .catch(() => setCostCenters([]));
  }, [businessId]);
  const [periods, setPeriods] = useState<FiscalPeriod[]>([]);
  const [periodsLoaded, setPeriodsLoaded] = useState(false);
  const [periodBusy, setPeriodBusy] = useState(false);
  const [form, setForm] = useState<JournalEntryFormValues>(() => (
    existing
      ? journalEntryToForm(existing)
      : copySource
        ? copyJournalEntryToForm(copySource, '')
        : newJournalEntryForm(todayLocal())
  ));
  const [automaticJournalNumber, setAutomaticJournalNumber] = useState(existing === undefined);
  const [numberRefresh, setNumberRefresh] = useState(0);
  const journalNumberEditedRef = useRef(existing !== undefined);
  const journalNumberRequestGateRef = useRef(new JournalNumberRequestGate());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [newAccountLineIndex, setNewAccountLineIndex] = useState<number | null>(null);
  const [primarySaveAction, setPrimarySaveAction] = useState<'new' | 'close'>(
    () => (localStorage.getItem('je_primarySaveAction') === 'close' ? 'close' : 'new'),
  );
  const [showSaveMenu, setShowSaveMenu] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const saveMenuRef = useRef<HTMLDivElement>(null);
  const pendingAccountFocusRef = useRef<number | null>(null);
  const navigate = useNavigate();
  const attachments = useAttachments('journal_entry', existing?.entry.id ?? null);
  const readOnly = existing !== undefined && !existing.can_correct;
  const supportsManualActions = journalSupportsManualActions(existing);
  const totals = journalEntryTotals(form.lines);
  const filledLineCount = form.lines.filter(line => line.account_id).length;
  const selectedPeriod = periods.find(period => (
    period.starts_on <= form.date && period.ends_on >= form.date
  ));
  const hasCompleteDate = /^\d{4}-\d{2}-\d{2}$/.test(form.date);
  const missingPeriod = periodsLoaded && hasCompleteDate && !selectedPeriod;
  const closedPeriod = selectedPeriod?.status === 'closed';
  const canSave = !readOnly && totals.balanced && filledLineCount >= 2
    && !busy && !periodBusy && !missingPeriod && !closedPeriod;

  useEffect(() => {
    if (!businessId) return;
    api.get<{ accounts: JournalAccount[] }>(`/businesses/${businessId}/coa`, {
      params: { include_inactive: 'true' },
    }).then(response => setAccounts(response.data.accounts));
  }, [businessId]);

  useEffect(() => {
    if (!businessId) return;
    setPeriodsLoaded(false);
    api.get<{ periods: FiscalPeriod[] }>(`/businesses/${businessId}/periods`)
      .then(response => {
        setPeriods(response.data.periods);
        setPeriodsLoaded(true);
      })
      .catch(() => setPeriodsLoaded(false));
  }, [businessId]);

  useEffect(() => {
    if (!businessId || existing) return;
    const requestGeneration = journalNumberRequestGateRef.current.start();
    api.get<{ journal_number: string }>(`/businesses/${businessId}/journal-entries/next-number`)
      .then(response => {
        if (!journalNumberRequestGateRef.current.isCurrent(requestGeneration)) return;
        if (journalNumberEditedRef.current) return;
        setForm(current => applyJournalNumberSuggestion(
          current,
          response.data.journal_number,
          journalNumberEditedRef.current,
        ));
        setAutomaticJournalNumber(true);
      })
      .catch((requestError: unknown) => {
        if (journalNumberRequestGateRef.current.isCurrent(requestGeneration)) {
          setError(pickErr(requestError));
        }
      });
    return () => journalNumberRequestGateRef.current.invalidate();
  }, [businessId, existing, numberRefresh]);

  useEffect(() => {
    function handle(event: MouseEvent) {
      if (saveMenuRef.current && !saveMenuRef.current.contains(event.target as Node)) {
        setShowSaveMenu(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  useEffect(() => {
    const rowIndex = pendingAccountFocusRef.current;
    if (rowIndex === null) return;
    pendingAccountFocusRef.current = null;
    document.getElementById(`journal-account-${rowIndex}`)?.focus();
  }, [form.lines.length]);

  function updateForm(patch: Partial<Omit<JournalEntryFormValues, 'lines'>>) {
    setForm(current => ({ ...current, ...patch }));
  }

  function updateLine(index: number, patch: Partial<JournalEntryFormLine>) {
    setForm(current => ({
      ...current,
      lines: current.lines.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line),
    }));
  }

  function pickLineAccount(index: number, accountId: string) {
    setForm(current => ({ ...current, lines: pickJournalLineAccount(current.lines, index, accountId) }));
  }

  function handleAccountCreated(account: JournalAccount) {
    setAccounts(current => [...current.filter(item => item.id !== account.id), account]);
    if (newAccountLineIndex !== null) {
      pickLineAccount(newAccountLineIndex, account.id);
    }
    setNewAccountLineIndex(null);
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
    setForm(current => ({ ...current, lines: Array.from({ length: MIN_BLANK_ROWS }, blankJournalLine) }));
  }

  function moveLine(targetIndex: number) {
    if (dragIndex === null || dragIndex === targetIndex) {
      setDragIndex(null); setOverIndex(null); return;
    }
    setForm(current => {
      const lines = [...current.lines];
      const moved = lines.splice(dragIndex, 1)[0];
      if (!moved) return current;
      lines.splice(targetIndex, 0, moved);
      return { ...current, lines };
    });
    setDragIndex(null); setOverIndex(null);
  }

  function handleLastLineTab(event: React.KeyboardEvent<HTMLInputElement>, rowIndex: number) {
    if (readOnly) return;
    if (!shouldAppendJournalLines({
      key: event.key,
      shiftKey: event.shiftKey,
      rowIndex,
      rowCount: form.lines.length,
    })) return;

    event.preventDefault();
    pendingAccountFocusRef.current = form.lines.length;
    setForm(current => ({
      ...current,
      lines: [...current.lines, blankJournalLine()],
    }));
  }

  function copyUnsavedEntry() {
    if (busy) return;
    journalNumberRequestGateRef.current.invalidate();
    setForm(current => copyUnsavedJournalEntry(current));
    journalNumberEditedRef.current = false;
    setAutomaticJournalNumber(true);
    setError(null);
    setNotice('Copied into a new unsaved journal entry.');
    setNumberRefresh(current => current + 1);
  }

  async function save(destination: JournalSaveDestination = 'detail') {
    if (!businessId || !canSave) return;
    setError(null);
    setBusy(true);
    try {
      const body = journalEntryPayload(form, {
        automaticNumber: !existing && automaticJournalNumber,
      });
      let savedId: string;
      if (existing) {
        const response = await api.put<{ entry: { id: string } }>(
          `/businesses/${businessId}/journal-entries/${existing.entry.id}`,
          body,
        );
        savedId = response.data.entry.id;
      } else {
        const response = await api.post<{ id: string }>(`/businesses/${businessId}/journal-entries`, body);
        savedId = response.data.id;
      }

      // Files added before the entry existed are uploaded now that it has an id.
      const attachWarning = existing ? null : await attachments.attachTo(savedId);
      if (attachWarning) {
        // Open the saved entry so the missing files can be re-added there.
        const state: SaveWarningState = { saveWarnings: [attachWarning] };
        navigate(`/journal/${savedId}`, { state });
        return;
      }

      if (destination === 'new') {
        if (existing) navigate(journalDestinationPath(destination, savedId));
        else {
          journalNumberRequestGateRef.current.invalidate();
          setForm(newJournalEntryForm(todayLocal()));
          attachments.reset();
          journalNumberEditedRef.current = false;
          setNumberRefresh(current => current + 1);
        }
      } else {
        navigate(journalDestinationPath(destination, savedId));
      }
    } catch (requestError: unknown) {
      setError(pickErr(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function createMissingPeriods() {
    if (!businessId || !missingPeriod || user?.role !== 'firm_admin') return;
    const year = Number(form.date.slice(0, 4));
    if (!Number.isInteger(year)) return;
    setPeriodBusy(true);
    setError(null);
    try {
      const response = await api.post<{ periods: FiscalPeriod[] }>(
        `/businesses/${businessId}/periods/seed-year`,
        { year },
      );
      setPeriods(current => [
        ...current.filter(period => !response.data.periods.some(created => created.id === period.id)),
        ...response.data.periods,
      ]);
      setNotice(`${year} fiscal periods created. You can save this journal entry now.`);
    } catch (requestError: unknown) {
      setError(pickErr(requestError));
    } finally {
      setPeriodBusy(false);
    }
  }

  // QBO calls this "Reverse" on a journal entry (distinct from "Void" on
  // deposits/expenses), but it's the same same-day reversing-entry logic:
  // ledger.voidJournalEntry, flipping the original to voided.
  async function reverseEntry() {
    if (!businessId || !existing?.can_correct) return;
    const reason = window.prompt('Reason for reversing this entry?');
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

  async function deleteEntry() {
    if (!businessId || !existing?.can_delete) return;
    const confirmed = window.confirm(
      existing.delete_removes_pair
        ? 'Delete this entry and the entry that reverses it? Both will be removed from the books and reports. This cannot be undone.'
        : 'Delete this journal entry? It will be removed from the books and reports. This cannot be undone.',
    );
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/businesses/${businessId}/journal-entries/${existing.entry.id}`);
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
        <RecentJournalEntries businessId={businessId} />
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
          {/* Copy for an existing entry moves to the More menu below (QBO layout);
              an unsaved draft has nothing to put there yet, so it keeps this button. */}
          {!existing && (
            <Button type="button" variant="ghost" size="sm" onClick={copyUnsavedEntry} disabled={busy}>
              <Copy className="mr-2 h-4 w-4" />
              Copy
            </Button>
          )}
          {existing?.entry.corrected_from_entry_id && (
            <Link className="text-primary hover:underline" to={`/journal/${existing.entry.corrected_from_entry_id}`}>
              Correction of Journal Entry #{existing.corrected_from_entry_journal_number}
            </Link>
          )}
          {existing?.entry.reversed_entry_id && (
            <Link className="text-primary hover:underline" to={`/journal/${existing.entry.reversed_entry_id}`}>
              Reversal of Journal Entry #{existing.reversed_entry_journal_number}
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
            : 'Saving updates this entry in place. The change is recorded in the audit history.'}
          {readOnly && existing.source_path && (
            <>{' '}<Link className="font-medium text-primary underline" to={existing.source_path}>Open the source transaction</Link></>
          )}
        </div>
      )}

      {missingPeriod && (
        <div className="mx-6 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <span>No fiscal period covers {fmtJournalDate(form.date)}.</span>
          {user?.role === 'firm_admin' ? (
            <Button type="button" size="sm" variant="outline" disabled={periodBusy} onClick={() => { void createMissingPeriods(); }}>
              {periodBusy ? 'Creating...' : `Create ${form.date.slice(0, 4)} periods`}
            </Button>
          ) : (
            <Link className="font-medium underline" to="/settings/periods">Open Fiscal Periods</Link>
          )}
        </div>
      )}
      {closedPeriod && (
        <div className="mx-6 mt-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          The fiscal period covering {fmtJournalDate(form.date)} is closed. Reopen it before posting this entry.
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
            onChange={event => {
              journalNumberRequestGateRef.current.invalidate();
              journalNumberEditedRef.current = true;
              setAutomaticJournalNumber(false);
              updateForm({ journalNo: event.target.value });
            }}
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
                <tr
                  key={index}
                  onDragOver={event => { if (!readOnly) { event.preventDefault(); setOverIndex(index); } }}
                  onDrop={() => { if (!readOnly) moveLine(index); }}
                  onDragEnd={() => { setDragIndex(null); setOverIndex(null); }}
                  className={[
                    'group border-b transition-colors hover:bg-muted/40',
                    dragIndex === index ? 'opacity-40' : '',
                    overIndex === index && dragIndex !== index ? 'border-t-2 border-primary' : '',
                  ].join(' ')}
                >
                  <td
                    className={`px-2 py-1.5 text-xs text-muted-foreground ${!readOnly ? 'cursor-grab active:cursor-grabbing select-none' : ''}`}
                    {...(!readOnly ? { draggable: true, onDragStart: () => setDragIndex(index) } : {})}
                  >
                    <span className="flex items-center gap-1">
                      {!readOnly && <GripVertical className="h-3.5 w-3.5 shrink-0" />}
                      {index + 1}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    <AccountSelect
                      id={`journal-account-${index}`}
                      ariaLabel={`Account, line ${index + 1}`}
                      accounts={journalAccountsForLine(accounts, line.account_id)}
                      value={line.account_id}
                      onChange={accountId => pickLineAccount(index, accountId)}
                      placeholder=""
                      disabled={readOnly}
                      className="w-full"
                      {...(!readOnly ? { onCreate: () => setNewAccountLineIndex(index) } : {})}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    {readOnly ? (
                      <div className="w-full px-3 py-2 text-right font-mono">{line.debit ? fmtMoney(line.debit) : ''}</div>
                    ) : (
                      <MoneyInput
                        value={line.debit}
                        onChange={event => updateLine(index, { debit: event.target.value, credit: '' })}
                        placeholder="0.00"
                        className="w-full text-right font-mono"
                      />
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {readOnly ? (
                      <div className="w-full px-3 py-2 text-right font-mono">{line.credit ? fmtMoney(line.credit) : ''}</div>
                    ) : (
                      <MoneyInput
                        value={line.credit}
                        onChange={event => updateLine(index, { credit: event.target.value, debit: '' })}
                        placeholder="0.00"
                        className="w-full text-right font-mono"
                      />
                    )}
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
                    {costCenters.length > 0 && !readOnly ? (
                      // A client with cost centers picks one; typing something else is still allowed.
                      <div onKeyDown={event => handleLastLineTab(event as unknown as React.KeyboardEvent<HTMLInputElement>, index)}>
                        <ComboInput
                          value={line.class_name}
                          onChange={value => updateLine(index, { class_name: value })}
                          options={costCenters}
                          className="w-full"
                        />
                      </div>
                    ) : (
                      <Input
                        value={line.class_name}
                        onChange={event => updateLine(index, { class_name: event.target.value })}
                        onKeyDown={event => handleLastLineTab(event, index)}
                        disabled={readOnly}
                        className="w-full"
                      />
                    )}
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
          <AttachmentsPanel attachments={attachments} />
        </div>
      </div>

      <PostErrorNotice className="mx-6 mb-2" />
      {error && <p className="px-6 pb-2 text-sm text-destructive">{error}</p>}
      {notice && <p className="px-6 pb-2 text-sm text-emerald-700">{notice}</p>}

      <div className="sticky -bottom-4 z-10 lg:-bottom-6 flex items-center gap-3 border-t bg-background px-6 py-3">
        <Button type="button" variant="outline" onClick={() => navigate(JOURNAL_CLOSE_PATH)}>
          {readOnly ? 'Back' : 'Cancel'}
        </Button>

        <div className="mx-auto flex items-center gap-4">
          {existing?.can_correct && (
            <Button type="button" variant="outline" size="sm" onClick={() => { void reverseEntry(); }} disabled={busy}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Reverse
            </Button>
          )}
          {supportsManualActions && (
            <button
              type="button"
              onClick={() => setRecurringOpen(true)}
              disabled={!totals.balanced || filledLineCount < 2}
              className="text-sm font-medium text-emerald-600 hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline"
            >
              Make recurring
            </button>
          )}
          {existing && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setMoreOpen(current => !current)}
                className="text-sm font-medium text-primary hover:underline"
              >
                More
              </button>
              {moreOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)} />
                  <div className="absolute bottom-8 left-1/2 z-50 w-56 -translate-x-1/2 rounded-lg border bg-card shadow-xl">
                    {!readOnly && supportsManualActions && (
                      <Link
                        to={`/journal/new?copy=${existing.entry.id}`}
                        onClick={() => setMoreOpen(false)}
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-sm hover:bg-accent"
                      >
                        <Copy className="h-4 w-4" /> Copy
                      </Link>
                    )}
                    {!readOnly && existing.can_delete && (
                      <button
                        type="button"
                        onClick={() => { setMoreOpen(false); void deleteEntry(); }}
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-destructive hover:bg-accent"
                      >
                        <Trash2 className="h-4 w-4" /> Delete
                      </button>
                    )}
                    {existing.source_path && (
                      <Link
                        to={existing.source_path}
                        onClick={() => setMoreOpen(false)}
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-sm hover:bg-accent"
                      >
                        <BookOpen className="h-4 w-4" /> Transaction journal
                      </Link>
                    )}
                    <button
                      type="button"
                      onClick={() => { setMoreOpen(false); setAuditOpen(true); }}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-sm hover:bg-accent"
                    >
                      <Clock className="h-4 w-4" /> Audit history
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {!readOnly && (
          <div className="ml-auto flex items-center gap-2">
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
      <JournalRecurringDialog
        businessId={businessId}
        form={form}
        open={recurringOpen}
        onOpenChange={setRecurringOpen}
        onCreated={() => setNotice('Recurring journal template created.')}
      />
      {auditOpen && existing && businessId && (
        <AuditHistoryModal
          url={`/businesses/${businessId}/journal-entries/${existing.entry.id}/audit-history`}
          onClose={() => setAuditOpen(false)}
        />
      )}
      {newAccountLineIndex !== null && (
        <AccountCreateDrawer
          businessId={businessId}
          accounts={accounts}
          onClose={() => setNewAccountLineIndex(null)}
          onCreated={handleAccountCreated}
        />
      )}
    </div>
  );
}
