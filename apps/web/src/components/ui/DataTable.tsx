import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowUp, ArrowDown, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { downloadAsExcel, downloadAsPdf } from '@/lib/download';

export type Column<T> = {
  key: string;
  header: string;
  align?: 'left' | 'right';
  sortable?: boolean;
  sortValue?: (row: T) => string | number;
  exportValue?: (row: T) => string | number | boolean | null | undefined;
  render: (row: T) => ReactNode;
};

export interface DataTableProps<T> {
  rows: T[];
  getRowId: (row: T) => string;
  columns: Column<T>[];
  defaultSortKey?: string;
  defaultSortDir?: 'asc' | 'desc';
  selectable?: boolean;
  // Controlled selection (QBO-style batch actions). When omitted, selection is
  // managed internally as before.
  selectedIds?: Set<string>;
  onSelectedIdsChange?: (next: Set<string>) => void;
  actions?: (row: T) => ReactNode;
  actionsHeader?: ReactNode;
  emptyMessage?: ReactNode;
  downloadable?: { filename: string; title: string };
  // QBO-style pager ("‹ Previous 1-75 Next ›"). Slices AFTER sorting so
  // column sorts operate on the full data set.
  pagination?: { pageSize: number };
}

export function DataTable<T>({
  rows,
  getRowId,
  columns,
  defaultSortKey,
  defaultSortDir = 'asc',
  selectable = true,
  selectedIds,
  onSelectedIdsChange,
  actions,
  actionsHeader,
  emptyMessage = 'No records.',
  downloadable,
  pagination,
}: DataTableProps<T>) {
  const firstSortable = columns.find(c => c.sortable);
  const [sortKey, setSortKey] = useState<string>(defaultSortKey ?? firstSortable?.key ?? '');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(defaultSortDir);
  const [internalSelected, setInternalSelected] = useState<Set<string>>(new Set());
  const selected = selectedIds ?? internalSelected;
  const setSelected = onSelectedIdsChange ?? setInternalSelected;
  const [page, setPage] = useState(0);
  const [excelBusy, setExcelBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  const sortedRows = useMemo(() => {
    const col = columns.find(c => c.key === sortKey);
    if (!col || !col.sortable) return rows;
    const value = col.sortValue ?? ((row: T) => {
      const n = col.render(row);
      return typeof n === 'string' || typeof n === 'number' ? n : '';
    });
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      const an = typeof av === 'string' ? av.toLowerCase() : av;
      const bn = typeof bv === 'string' ? bv.toLowerCase() : bv;
      if (an < bn) return -1 * dir;
      if (an > bn) return 1 * dir;
      return 0;
    });
  }, [rows, columns, sortKey, sortDir]);

  // Clamp the page when the row set shrinks (filters, deletions).
  const pageSize = pagination?.pageSize ?? 0;
  const pageCount = pagination ? Math.max(1, Math.ceil(sortedRows.length / pageSize)) : 1;
  useEffect(() => { if (page > pageCount - 1) setPage(Math.max(0, pageCount - 1)); }, [page, pageCount]);
  const visibleRows = pagination ? sortedRows.slice(page * pageSize, (page + 1) * pageSize) : sortedRows;
  const rangeStart = sortedRows.length === 0 ? 0 : page * pageSize + 1;
  const rangeEnd = pagination ? Math.min(sortedRows.length, (page + 1) * pageSize) : sortedRows.length;

  function toggleSort(k: string) {
    if (sortKey === k) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir('asc'); }
  }
  function toggleRow(id: string) {
    const n = new Set(selected);
    if (n.has(id)) n.delete(id); else n.add(id);
    setSelected(n);
  }
  // Header checkbox operates on the visible page (QBO behavior).
  const allSelected = visibleRows.length > 0 && visibleRows.every(r => selected.has(getRowId(r)));
  function toggleAll() {
    const n = new Set(selected);
    if (allSelected) visibleRows.forEach(r => n.delete(getRowId(r)));
    else visibleRows.forEach(r => n.add(getRowId(r)));
    setSelected(n);
  }

  const pager = pagination && (
    <div className="flex items-center justify-end gap-1 text-sm">
      <button
        type="button"
        onClick={() => setPage(p => Math.max(0, p - 1))}
        disabled={page === 0}
        className="inline-flex items-center gap-0.5 px-1.5 py-1 rounded text-muted-foreground enabled:hover:text-foreground disabled:opacity-40"
      >
        <ChevronLeft className="h-4 w-4" /> Previous
      </button>
      <span className="px-1 tabular-nums">{rangeStart}-{rangeEnd}</span>
      <button
        type="button"
        onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
        disabled={page >= pageCount - 1}
        className="inline-flex items-center gap-0.5 px-1.5 py-1 rounded text-muted-foreground enabled:hover:text-foreground disabled:opacity-40"
      >
        Next <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );

  const colSpan = (selectable ? 1 : 0) + columns.length + (actions ? 1 : 0);

  function exportCell(row: T, col: Column<T>): string {
    const explicit = col.exportValue?.(row);
    if (explicit !== undefined && explicit !== null) return String(explicit);

    const raw = (row as Record<string, unknown>)[col.key];
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      return String(raw);
    }

    if (col.sortValue) return String(col.sortValue(row));

    const rendered = col.render(row);
    return typeof rendered === 'string' || typeof rendered === 'number' ? String(rendered) : '';
  }

  function handleDownload(format: 'excel' | 'pdf') {
    if (!downloadable) return;
    const headers = columns.map(c => c.header);
    const exportRows = sortedRows.map(row =>
      columns.map(col => exportCell(row, col)),
    );
    if (format === 'excel') {
      setExcelBusy(true);
      try { downloadAsExcel(headers, exportRows, downloadable.filename); } finally { setExcelBusy(false); }
    } else {
      setPdfBusy(true);
      try { downloadAsPdf(headers, exportRows, downloadable.title, downloadable.filename); } finally { setPdfBusy(false); }
    }
  }

  return (
    <>
      {downloadable && (
        <div className="flex justify-end gap-2 border-b px-3 py-2">
          <Button size="sm" variant="outline" disabled={excelBusy} onClick={() => handleDownload('excel')}>
            {excelBusy ? 'Downloading…' : 'Download Excel'}
          </Button>
          <Button size="sm" variant="outline" disabled={pdfBusy} onClick={() => handleDownload('pdf')}>
            {pdfBusy ? 'Downloading…' : 'Download PDF'}
          </Button>
        </div>
      )}
    {pagination && <div className="border-b px-3 py-1.5">{pager}</div>}
    {/* Wrap in a horizontal scroll container so dense tables stay usable on
        narrow viewports instead of crushing columns or pushing the page wide. */}
    <div className="w-full overflow-x-auto">
    <table className="w-full min-w-[640px] text-sm sm:min-w-0">
      <thead className="border-b">
        <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {selectable && (
            <th className="p-3 w-10">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
            </th>
          )}
          {columns.map(c => (
            <th key={c.key} className={`p-3 ${c.align === 'right' ? 'text-right' : 'text-left'}`}>
              {c.sortable ? (
                <button
                  type="button"
                  onClick={() => toggleSort(c.key)}
                  className={`inline-flex items-center gap-1 ${sortKey === c.key ? 'text-foreground' : ''} hover:text-foreground`}
                >
                  {c.header}
                  {sortKey === c.key
                    ? (sortDir === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />)
                    : <ArrowUpDown className="h-3.5 w-3.5 opacity-30" />}
                </button>
              ) : (
                <span>{c.header}</span>
              )}
            </th>
          ))}
          {actions && <th className="p-3 text-right">{actionsHeader ?? 'Action'}</th>}
        </tr>
      </thead>
      <tbody>
        {visibleRows.map(row => {
          const id = getRowId(row);
          return (
            <tr key={id} className="border-b last:border-b-0 hover:bg-muted/80 transition-colors">
              {selectable && (
                <td className="p-3">
                  <input
                    type="checkbox"
                    checked={selected.has(id)}
                    onChange={() => toggleRow(id)}
                    aria-label={`Select ${id}`}
                  />
                </td>
              )}
              {columns.map(c => (
                <td key={c.key} className={`p-3 ${c.align === 'right' ? 'text-right' : ''}`}>
                  {c.render(row)}
                </td>
              ))}
              {actions && (
                <td className="p-3 text-right whitespace-nowrap">{actions(row)}</td>
              )}
            </tr>
          );
        })}
        {sortedRows.length === 0 && (
          <tr><td colSpan={colSpan} className="p-6 text-center text-muted-foreground">{emptyMessage}</td></tr>
        )}
      </tbody>
    </table>
    </div>
    {pagination && sortedRows.length > pageSize && <div className="border-t px-3 py-1.5">{pager}</div>}
    </>
  );
}
