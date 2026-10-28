import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileDown, Printer } from 'lucide-react';
import { DateInput } from '@/components/ui/date-input';
import { Button } from '@/components/ui/button';
import { ReportCard } from '@/components/ui/ReportCard';
import { LoadingIndicator } from '@/components/ui/LoadingIndicator';
import { useActiveBusinessId } from '@/lib/business';
import { useAuth } from '@/auth/useAuth';
import { useFiscalYear } from '@/lib/fiscalYear';
import { daysAgoLocal, fmtDateText, fmtLongDate, todayLocal } from '@/lib/dates';
import { fmtMoney } from '@/lib/money';
import { downloadAsExcel } from '@/lib/download';
import { printReport } from '@/lib/reportExport';
import { useCanOpen } from '@/lib/roleAccess';
import { exportRows, ISO_DATE, type ReportColumn, type ReportRow, type ReportTable } from './standardReports';

// The page every report built in standardReports.ts sits on: the dates, Refresh,
// Excel and Print, as on the P&L, and the report itself in the QuickBooks frame.

export type ReportDates = { start: string; end: string };
/** What a report may need besides its dates: where the company's fiscal year starts (1 to 12). */
export type ReportContext = { fiscalYearStartMonth: number };

function pickErr(e: unknown): string {
  const message = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)
    ?.response?.data?.error?.message;
  if (message) return message;
  // A builder's own refusal (too many months) says why; a failed request does not.
  return e instanceof Error && !('response' in e) ? e.message : 'Failed to load report';
}

const INDENT = ['pl-3', 'pl-6', 'pl-9', 'pl-12', 'pl-16'];
const indent = (depth: number): string => INDENT[Math.min(depth, INDENT.length - 1)]!;

function cellText(column: ReportColumn, value: string): string {
  if (value === '') return '';
  if (column.kind === 'money') return fmtMoney(value);
  if (column.kind === 'date' && ISO_DATE.test(value)) return fmtDateText(value);
  return value;
}

const alignOf = (column: ReportColumn): string => (column.kind === 'money' || column.kind === 'percent' ? 'text-right' : 'text-left');

function RowView({ row, columns }: { row: ReportRow; columns: ReportColumn[] }) {
  const canOpen = useCanOpen();
  if (row.kind === 'heading') {
    return (
      <tr className="border-b">
        <td colSpan={columns.length} className={`p-2 font-medium ${indent(row.depth)}`}>{row.label}</td>
      </tr>
    );
  }
  // The link goes on the first cell with something in it, when the role can open where it leads.
  const link = row.to && canOpen(row.to.split('?')[0] ?? row.to) ? row.to : null;
  const linkAt = link ? row.cells.findIndex(cell => cell !== '') : -1;
  return (
    <tr className={row.kind === 'total' ? 'border-b font-semibold' : 'border-b hover:bg-muted/30'}>
      {row.cells.map((cell, i) => {
        const column = columns[i] ?? { label: '', kind: 'text' };
        const text = cellText(column, cell);
        const nowrap = column.kind === 'text' ? '' : 'whitespace-nowrap';
        return (
          <td key={i} className={`p-2 ${alignOf(column)} ${column.kind === 'money' ? 'font-mono' : ''} ${nowrap} ${i === 0 ? indent(row.depth) : ''}`}>
            {i === linkAt && link
              ? <Link to={link} className="text-link underline-offset-4 hover:underline">{text}</Link>
              : text}
          </td>
        );
      })}
    </tr>
  );
}

export function StandardReport({
  title,
  dates,
  fileStem,
  load,
  opens = 'fiscalYear',
}: {
  title: string;
  /** A period (start and end), or one date (as of). */
  dates: 'period' | 'asOf';
  fileStem: string;
  /** Kept at module level by the caller, so the page does not reload on every render. */
  load: (bizId: string, range: ReportDates, context: ReportContext) => Promise<ReportTable>;
  /** Where a period starts when the page opens: the fiscal year, this month, or four days ago. */
  opens?: 'fiscalYear' | 'thisMonth' | 'recent';
}) {
  const [bizId] = useActiveBusinessId();
  const { businesses } = useAuth();
  const bizName = businesses.find(b => b.id === bizId)?.name ?? '';
  // A period opens on the client's fiscal year to date, as the P&L does.
  const fiscalYear = useFiscalYear();
  const fiscalYearStartMonth = fiscalYear.startMonth;
  const [start, setStart] = useState(() =>
    (opens === 'thisMonth' ? `${todayLocal().slice(0, 7)}-01` : opens === 'recent' ? daysAgoLocal(3) : fiscalYear.start));
  const [end, setEnd] = useState(todayLocal());
  const [table, setTable] = useState<ReportTable | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!bizId) return;
    setLoading(true);
    setErr(null);
    try {
      setTable(await load(bizId, { start, end }, { fiscalYearStartMonth }));
    } catch (e: unknown) {
      setErr(pickErr(e));
      setTable(null);
    } finally {
      setLoading(false);
    }
  }, [bizId, start, end, load, fiscalYearStartMonth]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (!bizId) return <div>Pick a business.</div>;

  const subtitle = dates === 'period' ? `${fmtLongDate(start)} – ${fmtLongDate(end)}` : `As of ${fmtLongDate(end)}`;
  const headers = table?.columns.map(column => column.label) ?? [];

  function handleExport() {
    if (!table) return;
    downloadAsExcel(headers, exportRows(table), `${fileStem}-${dates === 'period' ? `${start}-` : ''}${end}`, { title, subtitle });
  }

  function handlePrint() {
    if (!table) return;
    printReport({ title, subtitle, headers, rows: exportRows(table) });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-end gap-3">
        <h1 className="sr-only">{title}</h1>
        <div className="flex flex-wrap items-end gap-2">
          {dates === 'period' && (
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Period start</div>
              <DateInput value={start} onChange={e => setStart(e.target.value)} />
            </div>
          )}
          <div>
            <div className="mb-1 text-xs text-muted-foreground">{dates === 'period' ? 'Period end' : 'as of'}</div>
            <DateInput value={end} onChange={e => setEnd(e.target.value)} />
          </div>
          <Button variant="outline" onClick={() => { void refresh(); }} disabled={loading}>
            {loading ? <span className="inline-flex items-center gap-2"><LoadingIndicator size="sm" /> Loading…</span> : 'Refresh'}
          </Button>
          <div className="flex items-center gap-2">
            <div className="relative group">
              <button className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50" onClick={handleExport} disabled={!table} aria-label="Export to Excel">
                <FileDown className="h-4 w-4" />
              </button>
              <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">Export to Excel</div>
            </div>
            <div className="relative group">
              <button className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50" onClick={handlePrint} disabled={!table} aria-label="Print">
                <Printer className="h-4 w-4" />
              </button>
              <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">Print</div>
            </div>
          </div>
        </div>
      </div>

      {err && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {err}
        </div>
      )}

      {!table && loading && <LoadingIndicator />}

      {table && (
        <ReportCard companyName={bizName} title={title} subtitle={subtitle}>
          <div className="w-full overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b">
                <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {table.columns.map((column, i) => (
                    <th key={i} className={`p-2 ${alignOf(column)}`}>{column.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.length === 0 && (
                  <tr><td colSpan={table.columns.length} className="p-3 text-muted-foreground">Nothing to show for these dates.</td></tr>
                )}
                {table.rows.map((row, i) => <RowView key={i} row={row} columns={table.columns} />)}
              </tbody>
            </table>
          </div>
        </ReportCard>
      )}
    </div>
  );
}

