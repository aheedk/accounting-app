import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { pickErr } from '@/lib/apiErrors';

type BankAccount = {
  id: string;
  name: string;
  institution: string | null;
  account_last_four: string | null;
  cash_account_id: string;
  is_active: boolean;
};

type FieldMapping = 'transaction_date' | 'description' | 'amount' | 'external_id' | 'ignore';

type ParsedRow = {
  cells: string[];
  // Indices into cells match headers. `raw` is the whole physical source row for debugging.
};

type ParseResult = {
  headers: string[];
  rows: ParsedRow[];
  malformed: number;
};

type ImportResult = { imported: number; deduped: number };

type ImportBatch = {
  id: string;
  bank_account_id: string;
  bank_account_name: string | null;
  filename: string | null;
  rows_submitted: number;
  imported: number;
  deduped: number;
  created_at: string;
  undone_at: string | null;
  remaining_rows: string | number;
};

type ImportRow = {
  transaction_date: string;
  description: string;
  amount: string;
  external_id?: string;
};


// 30-line inline CSV parser. Handles:
// - Quoted fields with embedded commas: `"a, b",c`
// - Embedded newlines inside quotes: `"line1\nline2",c`
// - Escaped quotes inside quotes: `"he said ""hi""",c`
// - CRLF or LF line endings
// Malformed rows (wrong column count) are counted in `malformed`.
function parseCsv(text: string): ParseResult {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else { field += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        // End of record. Swallow \r\n.
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        rows.push(row); row = [];
      } else { field += ch; }
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }

  // Drop trailing empty rows (common at EOF).
  while (rows.length > 0) {
    const last = rows[rows.length - 1];
    if (last && last.length === 1 && (last[0] ?? '').trim() === '') rows.pop();
    else break;
  }

  if (rows.length === 0) return { headers: [], rows: [], malformed: 0 };
  const headers = (rows[0] ?? []).map(h => h.trim());
  const expected = headers.length;
  const data: ParsedRow[] = [];
  let malformed = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    if (r.length !== expected) { malformed++; continue; }
    data.push({ cells: r.map(c => c.trim()) });
  }
  return { headers, rows: data, malformed };
}

function detectMapping(header: string): FieldMapping {
  const h = header.toLowerCase();
  if (h.includes('transaction id') || h === 'reference' || h.includes('reference') || h === 'id' || h.endsWith(' id')) return 'external_id';
  if (h.includes('date')) return 'transaction_date';
  if (h.includes('description') || h.includes('memo') || h.includes('payee') || h.includes('narrative')) return 'description';
  if (h.includes('amount') || h.includes('value')) return 'amount';
  return 'ignore';
}

const MAPPING_OPTIONS: Array<{ value: FieldMapping; label: string }> = [
  { value: 'ignore', label: 'Ignore' },
  { value: 'transaction_date', label: 'Date' },
  { value: 'description', label: 'Description' },
  { value: 'amount', label: 'Amount' },
  { value: 'external_id', label: 'External ID' },
];

function normalizeAmount(raw: string): string | null {
  // Strip common currency symbols, spaces, thousands separators. Allow parens for negatives.
  let s = raw.trim();
  if (s === '') return null;
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) { negative = true; s = s.slice(1, -1); }
  s = s.replace(/[$£€¥\s,]/g, '');
  if (s === '' || s === '-' || s === '+') return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const final = negative ? -Math.abs(n) : n;
  return final.toFixed(4);
}

function normalizeDate(raw: string): string | null {
  const s = raw.trim();
  if (s === '') return null;
  // Already ISO (YYYY-MM-DD)?
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // MM/DD/YYYY or M/D/YYYY
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) {
    const mRaw = us[1]; const dRaw = us[2]; const yRaw = us[3];
    if (mRaw && dRaw && yRaw) {
      const mm = mRaw.padStart(2, '0');
      const dd = dRaw.padStart(2, '0');
      return `${yRaw}-${mm}-${dd}`;
    }
  }
  // Fallback: attempt Date parsing.
  const t = Date.parse(s);
  if (Number.isFinite(t)) {
    const d = new Date(t);
    const y = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${mm}-${dd}`;
  }
  return null;
}

export default function BankTransactionImportPage() {
  const [bizId] = useActiveBusinessId();
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [bankAccountId, setBankAccountId] = useState<string>('');
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [mapping, setMapping] = useState<FieldMapping[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [undoBusy, setUndoBusy] = useState<string | null>(null);
  const [undoMsg, setUndoMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  function loadBatches() {
    if (!bizId) return;
    api.get<{ batches: ImportBatch[] }>(`/businesses/${bizId}/bank-imports`)
      .then(r => setBatches(r.data.batches))
      .catch(() => undefined);
  }

  useEffect(() => {
    if (!bizId) return;
    (async () => {
      try {
        const r = await api.get(`/businesses/${bizId}/bank-accounts`);
        const list: BankAccount[] = r.data.bank_accounts;
        setBankAccounts(list);
        if (list.length > 0 && !bankAccountId) {
          const first = list[0];
          if (first) setBankAccountId(first.id);
        }
      } catch (e: unknown) {
        setErr(pickErr(e));
      }
    })();
    loadBatches();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bizId]);

  async function undoBatch(b: ImportBatch) {
    if (!bizId) return;
    if (!confirm(`Undo this import? Still-unreviewed rows from ${b.filename ?? 'this batch'} will be removed; anything already matched, categorized, or excluded is kept.`)) return;
    setUndoBusy(b.id); setUndoMsg(null); setErr(null);
    try {
      const r = await api.post<{ deleted: number; kept: number }>(`/businesses/${bizId}/bank-imports/${b.id}/undo`, {});
      setUndoMsg(`Removed ${r.data.deleted} transaction${r.data.deleted === 1 ? '' : 's'}${r.data.kept > 0 ? `; kept ${r.data.kept} already-reviewed` : ''}.`);
      loadBatches();
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setUndoBusy(null);
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setErr(null); setResult(null);
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      const p = parseCsv(text);
      setParsed(p);
      setMapping(p.headers.map(detectMapping));
    };
    reader.onerror = () => setErr('Failed to read file');
    reader.readAsText(file);
  }

  function updateMapping(colIdx: number, value: FieldMapping) {
    setMapping(m => m.map((v, i) => (i === colIdx ? value : v)));
  }

  const preview = useMemo(() => {
    if (!parsed) return [];
    return parsed.rows.slice(0, 10);
  }, [parsed]);

  const resolvedIndexes = useMemo(() => {
    const map: Record<Exclude<FieldMapping, 'ignore'>, number | undefined> = {
      transaction_date: undefined,
      description: undefined,
      amount: undefined,
      external_id: undefined,
    };
    mapping.forEach((f, i) => {
      if (f === 'ignore') return;
      // First column wins; subsequent columns with the same mapping are effectively ignored.
      if (map[f] === undefined) map[f] = i;
    });
    return map;
  }, [mapping]);

  const mappingComplete = resolvedIndexes.transaction_date !== undefined
    && resolvedIndexes.description !== undefined
    && resolvedIndexes.amount !== undefined;

  function buildRows(): { rows: ImportRow[]; skippedRows: number } {
    if (!parsed) return { rows: [], skippedRows: 0 };
    const di = resolvedIndexes.transaction_date;
    const descI = resolvedIndexes.description;
    const amtI = resolvedIndexes.amount;
    const extI = resolvedIndexes.external_id;
    if (di === undefined || descI === undefined || amtI === undefined) return { rows: [], skippedRows: 0 };
    const out: ImportRow[] = [];
    let skipped = 0;
    for (const r of parsed.rows) {
      const dateRaw = r.cells[di] ?? '';
      const descRaw = r.cells[descI] ?? '';
      const amtRaw = r.cells[amtI] ?? '';
      const date = normalizeDate(dateRaw);
      const amount = normalizeAmount(amtRaw);
      const description = descRaw.trim();
      if (!date || !amount || description === '') { skipped++; continue; }
      const row: ImportRow = { transaction_date: date, description, amount };
      if (extI !== undefined) {
        const ext = (r.cells[extI] ?? '').trim();
        if (ext !== '') row.external_id = ext;
      }
      out.push(row);
    }
    return { rows: out, skippedRows: skipped };
  }

  async function submit() {
    if (!bizId || !bankAccountId || !parsed) return;
    const { rows } = buildRows();
    if (rows.length === 0) { setErr('No valid rows to import'); return; }
    setBusy(true); setErr(null); setResult(null);
    try {
      const r = await api.post(`/businesses/${bizId}/bank-transactions/import`, {
        bank_account_id: bankAccountId,
        filename: fileName || null,
        rows,
      });
      setResult({ imported: r.data.imported, deduped: r.data.deduped });
      loadBatches();
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setParsed(null);
    setMapping([]);
    setFileName('');
    setResult(null);
    setErr(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  if (!bizId) return <div>Pick a business.</div>;

  if (bankAccounts.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Import Bank Transactions</h1>
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          No bank accounts — create one in <Link to="/accounting/bank-accounts" className="text-primary underline">Bank Accounts</Link> first.
        </CardContent></Card>
      </div>
    );
  }

  const built = buildRows();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Import Bank Transactions</h1>
        <Button asChild variant="outline"><Link to="/accounting/bank-transactions">Back to inbox</Link></Button>
      </div>

      <Card>
        <CardHeader><CardTitle>1. Select bank account and file</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label>Bank account</Label>
            <select
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={bankAccountId}
              onChange={e => setBankAccountId(e.target.value)}
            >
              {bankAccounts.map(b => (
                <option key={b.id} value={b.id}>
                  {b.name}{b.account_last_four ? ` ••${b.account_last_four}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={onFileChange}
            />
            <Button type="button" onClick={() => fileRef.current?.click()}>Choose CSV…</Button>
            <span className="text-sm text-muted-foreground truncate">{fileName || 'No file selected'}</span>
            {parsed && <Button type="button" variant="ghost" size="sm" onClick={reset}>Reset</Button>}
          </div>
        </CardContent>
      </Card>

      {parsed && (
        <Card>
          <CardHeader><CardTitle>2. Column mapping</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {parsed.rows.length} row{parsed.rows.length === 1 ? '' : 's'} parsed
              {parsed.malformed > 0 && <> · <span className="text-destructive">{parsed.malformed} malformed row{parsed.malformed === 1 ? '' : 's'} skipped</span></>}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border">
                <thead className="bg-muted/40 border-b">
                  <tr>
                    {parsed.headers.map((h, i) => (
                      <th key={i} className="p-2 text-left">
                        <div className="font-semibold">{h}</div>
                        <select
                          className="mt-1 h-8 rounded-md border bg-background px-2 text-xs"
                          value={mapping[i] ?? 'ignore'}
                          onChange={e => updateMapping(i, e.target.value as FieldMapping)}
                        >
                          {MAPPING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r, ri) => (
                    <tr key={ri} className="border-b last:border-b-0">
                      {r.cells.map((c, ci) => <td key={ci} className="p-2 font-mono text-xs">{c}</td>)}
                    </tr>
                  ))}
                  {parsed.rows.length > 10 && (
                    <tr><td colSpan={parsed.headers.length} className="p-2 text-center text-xs text-muted-foreground">…and {parsed.rows.length - 10} more rows</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {!mappingComplete && (
              <p className="text-sm text-destructive">
                Map columns for Date, Description, and Amount to proceed. External ID is optional.
              </p>
            )}
            {mappingComplete && (
              <p className="text-sm text-muted-foreground">
                Ready to import: <span className="font-semibold">{built.rows.length}</span> row{built.rows.length === 1 ? '' : 's'}
                {built.skippedRows > 0 && <> · {built.skippedRows} row{built.skippedRows === 1 ? '' : 's'} will be skipped (bad date/amount)</>}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {err && <p className="text-sm text-destructive">{err}</p>}

      {result && (
        <Card>
          <CardHeader><CardTitle>Import complete</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>Imported <span className="font-semibold">{result.imported}</span> new transaction{result.imported === 1 ? '' : 's'}, deduped <span className="font-semibold">{result.deduped}</span>.</p>
            <div className="flex gap-2 pt-2">
              <Button asChild size="sm"><Link to="/accounting/bank-transactions">Go to inbox</Link></Button>
              <Button size="sm" variant="outline" onClick={reset}>Import another file</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {parsed && !result && (
        <div className="flex gap-2">
          <Button type="button" onClick={submit} disabled={busy || !mappingComplete || built.rows.length === 0}>
            {busy ? 'Importing…' : `Import ${built.rows.length} row${built.rows.length === 1 ? '' : 's'}`}
          </Button>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>Import history</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {undoMsg && <p className="text-sm text-green-600">{undoMsg}</p>}
          {batches.length === 0 ? (
            <p className="text-sm text-muted-foreground">No imports yet for this company.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40">
                  <tr>
                    <th className="p-2 text-left text-xs font-medium uppercase tracking-wide">Imported</th>
                    <th className="p-2 text-left text-xs font-medium uppercase tracking-wide">File</th>
                    <th className="p-2 text-left text-xs font-medium uppercase tracking-wide">Account</th>
                    <th className="p-2 text-right text-xs font-medium uppercase tracking-wide">New</th>
                    <th className="p-2 text-right text-xs font-medium uppercase tracking-wide">Deduped</th>
                    <th className="p-2 text-right text-xs font-medium uppercase tracking-wide">Remaining</th>
                    <th className="p-2 text-left text-xs font-medium uppercase tracking-wide">Status</th>
                    <th className="p-2 text-right text-xs font-medium uppercase tracking-wide">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map(b => (
                    <tr key={b.id} className="border-b last:border-b-0">
                      <td className="p-2 font-mono text-xs">{new Date(b.created_at).toLocaleString()}</td>
                      <td className="p-2">{b.filename ?? '—'}</td>
                      <td className="p-2">{b.bank_account_name ?? '—'}</td>
                      <td className="p-2 text-right font-mono">{b.imported}</td>
                      <td className="p-2 text-right font-mono">{b.deduped}</td>
                      <td className="p-2 text-right font-mono">{Number(b.remaining_rows)}</td>
                      <td className="p-2">
                        {b.undone_at
                          ? <span className="text-muted-foreground">Undone</span>
                          : <span className="text-emerald-600">Active</span>}
                      </td>
                      <td className="p-2 text-right">
                        {!b.undone_at && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-auto p-0 font-normal text-primary hover:text-primary"
                            disabled={undoBusy === b.id}
                            onClick={() => undoBatch(b)}
                          >
                            {undoBusy === b.id ? 'Undoing…' : 'Undo'}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
