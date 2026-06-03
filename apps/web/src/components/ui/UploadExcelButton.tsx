import { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';

export interface ImportColumn {
  key: string;
  header: string;
  required?: boolean;
}

interface ImportRow {
  data: Record<string, string>;
  status: 'pending' | 'ok' | 'error';
  error: string | null;
}

interface Props {
  columns: ImportColumn[];
  entityName: string;
  onImportRow: (row: Record<string, string>) => Promise<void>;
  onDone: () => void;
}

export function UploadExcelButton({ columns, entityName, onImportRow, onDone }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState(false);
  const [parseErr, setParseErr] = useState<string | null>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!inputRef.current) return;
    inputRef.current.value = '';
    if (!file) return;
    setParseErr(null);
    setDone(false);
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = ev.target?.result;
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0] ?? ''];
        if (!ws) { setParseErr('No sheet found in file.'); return; }
        const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
        if (raw.length === 0) { setParseErr('The sheet is empty.'); return; }
        const colMap: Record<string, string> = {};
        columns.forEach(c => { colMap[c.header.toLowerCase()] = c.key; });
        const parsed: ImportRow[] = raw.map(r => {
          const row: Record<string, string> = {};
          for (const [k, v] of Object.entries(r)) {
            const mapped = colMap[k.trim().toLowerCase()];
            if (mapped) row[mapped] = String(v ?? '').trim();
          }
          const missing = columns.filter(c => c.required && !row[c.key]);
          return {
            data: row,
            status: 'pending',
            error: missing.length ? `Missing required: ${missing.map(c => c.header).join(', ')}` : null,
          };
        });
        setRows(parsed);
        setOpen(true);
      } catch {
        setParseErr('Could not read file. Make sure it is a valid .xlsx file.');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  async function runImport() {
    setImporting(true);
    const updated = [...rows];
    for (let i = 0; i < updated.length; i++) {
      const row = updated[i]!;
      if (row.error) { row.status = 'error'; continue; }
      try {
        await onImportRow(row.data);
        row.status = 'ok';
      } catch (e: unknown) {
        row.status = 'error';
        row.error = (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Import failed';
      }
      // eslint-disable-next-line no-await-in-loop
      setRows([...updated]);
    }
    setImporting(false);
    setDone(true);
    onDone();
  }

  const validCount = rows.filter(r => !r.error).length;
  const successCount = rows.filter(r => r.status === 'ok').length;
  const errorCount = rows.filter(r => r.status === 'error').length;

  return (
    <>
      <input ref={inputRef} type="file" accept=".xlsx" className="hidden" onChange={handleFile} />
      <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
        Upload Excel
      </Button>
      {parseErr && <p className="text-sm text-destructive mt-1">{parseErr}</p>}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-background rounded-lg shadow-xl w-full max-w-3xl mx-4 flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold">Import {entityName}</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {done
                    ? `Done — ${successCount} imported, ${errorCount} failed`
                    : `${validCount} of ${rows.length} rows ready to import`}
                </p>
              </div>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground text-xl font-medium"
                onClick={() => { setOpen(false); setRows([]); setDone(false); }}
              >
                ✕
              </button>
            </div>

            <div className="overflow-auto flex-1 p-4">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40">
                  <tr>
                    <th className="p-2 text-left w-8">#</th>
                    {columns.map(c => (
                      <th key={c.key} className="p-2 text-left">{c.header}</th>
                    ))}
                    <th className="p-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i} className="border-b last:border-b-0">
                      <td className="p-2 text-muted-foreground">{i + 1}</td>
                      {columns.map(c => (
                        <td key={c.key} className="p-2 truncate max-w-[150px]">{row.data[c.key] ?? ''}</td>
                      ))}
                      <td className="p-2 whitespace-nowrap">
                        {row.status === 'ok' && <span className="text-emerald-600 font-medium">✓ Imported</span>}
                        {row.status === 'error' && <span className="text-destructive text-xs">{row.error ?? 'Error'}</span>}
                        {row.status === 'pending' && row.error && <span className="text-amber-600 text-xs">{row.error}</span>}
                        {row.status === 'pending' && !row.error && <span className="text-muted-foreground">Ready</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="border-t px-6 py-4 flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Expected columns: {columns.map(c => `${c.header}${c.required ? '*' : ''}`).join(', ')}
              </p>
              {!done && (
                <Button onClick={() => void runImport()} disabled={importing || validCount === 0}>
                  {importing ? 'Importing…' : `Import ${validCount} record${validCount === 1 ? '' : 's'}`}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
