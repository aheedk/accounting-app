import { useMemo, useState, type ReactNode } from 'react';
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { downloadAsExcel, downloadAsPdf } from '@/lib/download';

export type Column<T> = {
  key: string;
  header: string;
  align?: 'left' | 'right';
  sortable?: boolean;
  sortValue?: (row: T) => string | number;
  render: (row: T) => ReactNode;
};

export interface DataTableProps<T> {
  rows: T[];
  getRowId: (row: T) => string;
  columns: Column<T>[];
  defaultSortKey?: string;
  defaultSortDir?: 'asc' | 'desc';
  selectable?: boolean;
  actions?: (row: T) => ReactNode;
  actionsHeader?: ReactNode;
  emptyMessage?: string;
  downloadable?: { filename: string; title: string };
}

export function DataTable<T>({
  rows,
  getRowId,
  columns,
  defaultSortKey,
  defaultSortDir = 'asc',
  selectable = true,
  actions,
  actionsHeader,
  emptyMessage = 'No records.',
  downloadable,
}: DataTableProps<T>) {
  const firstSortable = columns.find(c => c.sortable);
  const [sortKey, setSortKey] = useState<string>(defaultSortKey ?? firstSortable?.key ?? '');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(defaultSortDir);
  const [selected, setSelected] = useState<Set<string>>(new Set());
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

  function toggleSort(k: string) {
    if (sortKey === k) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir('asc'); }
  }
  function toggleRow(id: string) {
    setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  const allSelected = sortedRows.length > 0 && sortedRows.every(r => selected.has(getRowId(r)));
  function toggleAll() { setSelected(allSelected ? new Set() : new Set(sortedRows.map(r => getRowId(r)))); }

  const colSpan = (selectable ? 1 : 0) + columns.length + (actions ? 1 : 0);

  function handleDownload(format: 'excel' | 'pdf') {
    if (!downloadable) return;
    const headers = columns.map(c => c.header);
    const exportRows = sortedRows.map(row =>
      columns.map(col => (col.sortValue ? String(col.sortValue(row)) : '')),
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
    <table className="w-full text-sm">
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
        {sortedRows.map(row => {
          const id = getRowId(row);
          return (
            <tr key={id} className="border-b last:border-b-0 hover:bg-muted/30">
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
    </>
  );
}
