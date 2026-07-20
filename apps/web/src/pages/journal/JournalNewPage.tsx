import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Copy, Paperclip, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DateInput } from '@/components/ui/date-input';
import { AccountSelect } from '@/components/ui/AccountSelect';
import { fmtMoney, parseMoneyInput } from '@/lib/money';
import { todayLocal } from '@/lib/dates';

type Account = { id: string; code: string; name: string; account_type: string };
type Line = { account_id: string; debit: string; credit: string; description: string; name: string; class_name: string };

const blank = (): Line => ({ account_id: '', debit: '', credit: '', description: '', name: '', class_name: '' });
const DEFAULT_ROWS = 8;

function pickErr(e: unknown): string {
  return (e as { response?: { data?: { error?: { message?: string } } } } | undefined)
    ?.response?.data?.error?.message ?? 'Failed';
}

export default function JournalNewPage() {
  const [bizId] = useActiveBusinessId();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [date, setDate] = useState(todayLocal());
  const [journalNo, setJournalNo] = useState('');
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<Line[]>(Array.from({ length: DEFAULT_ROWS }, blank));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [primarySaveAction, setPrimarySaveAction] = useState<'new' | 'close'>(
    () => (localStorage.getItem('je_primarySaveAction') === 'close' ? 'close' : 'new')
  );
  const [showSaveMenu, setShowSaveMenu] = useState(false);
  const saveMenuRef = useRef<HTMLDivElement>(null);
  const nav = useNavigate();

  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/coa`).then(r => setAccounts(r.data.accounts));
  }, [bizId]);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (saveMenuRef.current && !saveMenuRef.current.contains(e.target as Node)) {
        setShowSaveMenu(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  function update(i: number, patch: Partial<Line>) {
    setLines(ls => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  }

  function copyLine(i: number) {
    const src = lines[i];
    if (!src) return;
    setLines(ls => { const n = [...ls]; n.splice(i + 1, 0, { ...src }); return n; });
  }

  function removeLine(i: number) {
    setLines(ls => ls.filter((_, idx) => idx !== i));
  }

  function resetForm() {
    setLines(Array.from({ length: DEFAULT_ROWS }, blank));
    setMemo(''); setJournalNo(''); setIsAdjusting(false);
    setDate(todayLocal());
  }

  async function save(mode: 'new' | 'close' | 'detail' = 'detail') {
    if (!bizId || !balanced) return;
    setErr(null); setBusy(true);
    try {
      const filledLines = lines.filter(l => l.account_id);
      const body = {
        entry_date: date,
        memo: memo || null,
        reference: journalNo || null,
        lines: filledLines.map(l => ({
          account_id: l.account_id,
          debit: parseMoneyInput(l.debit || '0'),
          credit: parseMoneyInput(l.credit || '0'),
          memo: l.description || null,
        })),
      };
      const r = await api.post(`/businesses/${bizId}/journal-entries`, body);
      if (mode === 'new') resetForm();
      else if (mode === 'close') nav('/journal');
      else nav(`/journal/${r.data.id}`);
    } catch (e: unknown) { setErr(pickErr(e)); }
    finally { setBusy(false); }
  }

  const filledLines = lines.filter(l => l.account_id);
  const totalD = filledLines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  const totalC = filledLines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const balanced = Math.abs(totalD - totalC) < 0.005 && totalD > 0;

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <div className="flex flex-col -mx-6 -my-6 min-h-[calc(100vh-4rem)]">
      {/* Page header */}
      <div className="flex items-center gap-3 border-b px-6 py-4 bg-background">
        <h1 className="text-xl font-semibold">
          Journal Entry{journalNo ? ` #${journalNo}` : ''}
        </h1>
      </div>

      {/* Header fields */}
      <div className="flex items-end gap-8 px-6 pt-5 pb-4 border-b bg-muted/10">
        <div>
          <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
            Journal date
          </label>
          <DateInput value={date} onChange={e => setDate(e.target.value)} required className="w-44" />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
            Journal no.
          </label>
          <Input
            value={journalNo}
            onChange={e => setJournalNo(e.target.value)}
            placeholder="e.g. AJE3"
            className="w-44"
          />
        </div>
        <div className="flex items-center gap-2 pb-0.5">
          <span className="text-sm text-muted-foreground">Is Adjusting Journal Entry?</span>
          <input
            type="checkbox"
            checked={isAdjusting}
            onChange={e => setIsAdjusting(e.target.checked)}
            className="h-4 w-4 rounded border-input cursor-pointer"
          />
        </div>
      </div>

      {/* Lines table */}
      <div className="flex-1 overflow-auto px-6 py-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-t">
                <th className="w-8 px-2 py-2.5 text-left text-xs font-semibold text-muted-foreground">#</th>
                <th className="px-2 py-2.5 text-left text-xs font-semibold text-muted-foreground min-w-[180px]">ACCOUNT</th>
                <th className="w-32 px-2 py-2.5 text-right text-xs font-semibold text-muted-foreground">DEBITS</th>
                <th className="w-32 px-2 py-2.5 text-right text-xs font-semibold text-muted-foreground">CREDITS</th>
                <th className="px-2 py-2.5 text-left text-xs font-semibold text-muted-foreground min-w-[160px]">DESCRIPTION</th>
                <th className="w-36 px-2 py-2.5 text-left text-xs font-semibold text-muted-foreground">NAME</th>
                <th className="w-28 px-2 py-2.5 text-left text-xs font-semibold text-muted-foreground">CLASS</th>
                <th className="w-14 px-2 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-b hover:bg-muted/40 group transition-colors">
                  <td className="px-2 py-1.5 text-xs text-muted-foreground">{i + 1}</td>
                  <td className="px-2 py-1.5">
                    <AccountSelect
                      accounts={accounts}
                      value={l.account_id}
                      onChange={id => update(i, { account_id: id })}
                      placeholder=""
                      className="w-full"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input
                      type="number" step="0.01" min="0"
                      value={l.debit}
                      onChange={e => update(i, { debit: e.target.value, credit: '' })}
                      placeholder="0.00"
                      className="text-right font-mono w-full"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input
                      type="number" step="0.01" min="0"
                      value={l.credit}
                      onChange={e => update(i, { credit: e.target.value, debit: '' })}
                      placeholder="0.00"
                      className="text-right font-mono w-full"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input
                      value={l.description}
                      onChange={e => update(i, { description: e.target.value })}
                      placeholder=""
                      className="w-full"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input
                      value={l.name}
                      onChange={e => update(i, { name: e.target.value })}
                      placeholder=""
                      className="w-full"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input
                      value={l.class_name}
                      onChange={e => update(i, { class_name: e.target.value })}
                      placeholder=""
                      className="w-full"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={() => copyLine(i)}
                        className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
                        aria-label="Copy line"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeLine(i)}
                        className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-muted"
                        aria-label="Delete line"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {/* Total row */}
              <tr className="border-t bg-muted/30">
                <td className="px-2 py-2.5" />
                <td className="px-2 py-2.5 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Total
                </td>
                <td className="px-2 py-2.5 text-right font-mono font-semibold">{fmtMoney(totalD)}</td>
                <td className="px-2 py-2.5 text-right font-mono font-semibold">{fmtMoney(totalC)}</td>
                <td colSpan={4} className="px-2 py-2.5">
                  {filledLines.length > 0 && (
                    <span className={`text-xs font-semibold ${balanced ? 'text-emerald-600' : 'text-destructive'}`}>
                      {balanced ? '✓ Balanced' : '✗ Unbalanced'}
                    </span>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Add / Clear lines */}
        <div className="flex items-center gap-3 mt-3">
          <button
            type="button"
            onClick={() => setLines(ls => [...ls, blank(), blank(), blank()])}
            className="text-sm border rounded px-3 py-1.5 hover:bg-muted/50 transition-colors"
          >
            Add lines
          </button>
          <button
            type="button"
            onClick={() => setLines(Array.from({ length: DEFAULT_ROWS }, blank))}
            className="text-sm border rounded px-3 py-1.5 hover:bg-muted/50 transition-colors"
          >
            Clear all lines
          </button>
        </div>

        {/* Memo + Attachments */}
        <div className="grid grid-cols-2 gap-6 mt-10">
          <div>
            <label className="block text-sm font-medium mb-2">Memo</label>
            <textarea
              value={memo}
              onChange={e => setMemo(e.target.value)}
              rows={4}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Attachments</label>
            <div className="border-2 border-dashed rounded-md flex flex-col items-center justify-center gap-1.5 h-[108px] text-muted-foreground text-sm cursor-pointer hover:border-primary/40 hover:bg-muted/20 transition-colors">
              <Paperclip className="h-5 w-5" />
              <span>Add attachment</span>
              <span className="text-xs">Max file size: 20 MB</span>
            </div>
          </div>
        </div>
      </div>

      {err && <p className="px-6 pb-2 text-sm text-destructive">{err}</p>}

      {/* Sticky footer */}
      <div className="sticky bottom-0 border-t bg-background px-6 py-3 flex items-center gap-4">
        <Button type="button" variant="outline" onClick={() => nav('/journal')}>
          Cancel
        </Button>

        <button
          type="button"
          className="mx-auto text-sm font-medium text-emerald-600 hover:underline"
        >
          Make recurring
        </button>

        <div className="flex items-center gap-2">
          <Button type="button" disabled={!balanced || busy} onClick={() => save('detail')}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
          <div className="relative flex" ref={saveMenuRef}>
            <Button
              type="button"
              disabled={!balanced || busy}
              onClick={() => save(primarySaveAction)}
              className="rounded-r-none"
            >
              {busy ? 'Saving…' : primarySaveAction === 'new' ? 'Save and new' : 'Save and close'}
            </Button>
            <div className="relative group">
              <Button
                type="button"
                disabled={!balanced || busy}
                aria-label="Save and new menu"
                onClick={() => setShowSaveMenu(m => !m)}
                className="rounded-l-none border-l border-l-primary-foreground/30 px-2"
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
              <div className="pointer-events-none absolute bottom-full right-0 mb-1.5 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                Save and new menu
              </div>
            </div>
            {showSaveMenu && (
              <div className="absolute bottom-full right-0 mb-1 w-44 rounded-md border bg-background shadow-lg z-50 py-1">
                <button
                  type="button"
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-accent"
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
      </div>
    </div>
  );
}
