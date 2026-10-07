import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowUp, ArrowDown, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { downloadAsExcel, downloadAsPdf } from '@/lib/download';
import { useAuth } from '@/auth/useAuth';
import { TableSettingsDrawer, TableSettingsGearButton, type TableColumnDef } from '@/components/ui/TableSettingsDrawer';
import { loadTableSettings, saveTableSettings, ROW_HEIGHT_CLASS } from '@/lib/tableSettings';

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
  // Makes the whole row clickable (QBO-style list pages) instead of relying
  // on an explicit actions column. Mutually exclusive in practice with
  // `selectable`/`actions` — nothing stops combining them, but a row click
  // target under a checkbox or action link is confusing, so callers doing
  // that should stop propagation on those inner elements themselves.
  onRowClick?: (row: T) => void;
  emptyMessage?: ReactNode;
  downloadable?: { filename: string; title: string };
  // QBO-style pager ("‹ Previous 1-75 Next ›"). Slices AFTER sorting so
  // column sorts operate on the full data set.
  pagination?: { pageSize: number };
  // Opts this table into the "Table settings" drawer (sort/rows/columns,
  // persisted per user per page). Give every list page that shares this
  // component its own stable pageId ("vendors", "checks", ...).
  tableSettingsPageId?: string;
  // The fields offered in the drawer's Sort section — defaults to `columns`.
  // Pass this when the sortable fields should read differently than the
  // visible column list (QBO curates its own "Sort by" set, e.g. it skips
  // Memo/Status and can include fields that aren't columns at all).
  sortableFields?: TableColumnDef[];
  availableFilters?: TableColumnDef[];
  // By default DataTable renders its own gear-icon opener in a toolbar row
  // above the table. Pass this pair to have the page render its own opener
  // instead (e.g. a "Customize" button inline with a filter bar) — DataTable
  // still owns the drawer and the settings themselves, just controlled via
  // this open state rather than its own internal one.
  externalSettingsOpen?: boolean;
  onExternalSettingsOpenChange?: (open: boolean) => void;
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
  onRowClick,
  emptyMessage = 'No records.',
  downloadable,
  pagination,
  tableSettingsPageId,
  sortableFields,
  availableFilters,
  externalSettingsOpen,
  onExternalSettingsOpenChange,
}: DataTableProps<T>) {
  const { user } = useAuth();
  const allColumnKeys = useMemo(() => columns.map(c => c.key), [columns]);
  const [internalSettingsOpen, setInternalSettingsOpen] = useState(false);
  const settingsOpen = onExternalSettingsOpenChange ? (externalSettingsOpen ?? false) : internalSettingsOpen;
  const setSettingsOpen = onExternalSettingsOpenChange ?? setInternalSettingsOpen;
  const [tableSettings, setTableSettings] = useState(() => (
    tableSettingsPageId && user ? loadTableSettings(user.id, tableSettingsPageId, allColumnKeys) : null
  ));
  useEffect(() => {
    if (tableSettingsPageId && user) setTableSettings(loadTableSettings(user.id, tableSettingsPageId, allColumnKeys));
    else setTableSettings(null);
    // allColumnKeys is derived fresh each render from `columns`; comparing by
    // identity would reload on every render, so key off the page instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableSettingsPageId, user?.id]);
  function updateTableSettings(next: NonNullable<typeof tableSettings>) {
    setTableSettings(next);
    if (tableSettingsPageId && user) saveTableSettings(user.id, tableSettingsPageId, next);
  }

  const effectiveColumns = useMemo(() => {
    if (!tableSettings) return columns;
    const byKey = new Map(columns.map(c => [c.key, c]));
    return tableSettings.columnOrder
      .filter(k => tableSettings.visibleColumns.includes(k))
      .map(k => byKey.get(k))
      .filter((c): c is Column<T> => !!c);
  }, [columns, tableSettings]);

  const firstSortable = columns.find(c => c.sortable);
  const settingsSort = tableSettings?.sort[0];
  const [sortKey, setSortKey] = useState<string>(settingsSort?.columnKey ?? defaultSortKey ?? firstSortable?.key ?? '');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(settingsSort?.direction ?? defaultSortDir);
  useEffect(() => {
    if (settingsSort) { setSortKey(settingsSort.columnKey); setSortDir(settingsSort.direction); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsSort?.columnKey, settingsSort?.direction]);
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
  const pageSize = tableSettings?.pageSize ?? pagination?.pageSize ?? 0;
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

  const colSpan = (selectable ? 1 : 0) + effectiveColumns.length + (actions ? 1 : 0);
  const rowPadding = ROW_HEIGHT_CLASS[tableSettings?.rowHeight ?? 'comfortable'];

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
      try { downloadAsExcel(headers, exportRows, downloadable.filename, { title: downloadable.title }); } finally { setExcelBusy(false); }
    } else {
      setPdfBusy(true);
      try { downloadAsPdf(headers, exportRows, downloadable.title, downloadable.filename); } finally { setPdfBusy(false); }
    }
  }

  return (
    <>
      {(downloadable || (tableSettingsPageId && !onExternalSettingsOpenChange)) && (
        <div className="flex justify-end gap-2 border-b px-3 py-2">
          {downloadable && (
            <>
              <Button size="sm" variant="outline" disabled={excelBusy} onClick={() => handleDownload('excel')}>
                {excelBusy ? 'Downloading…' : 'Download Excel'}
              </Button>
              <Button size="sm" variant="outline" disabled={pdfBusy} onClick={() => handleDownload('pdf')}>
                {pdfBusy ? 'Downloading…' : 'Download PDF'}
              </Button>
            </>
          )}
          {tableSettingsPageId && tableSettings && !onExternalSettingsOpenChange && (
            <TableSettingsGearButton onClick={() => setSettingsOpen(true)} />
          )}
        </div>
      )}
      {tableSettingsPageId && tableSettings && (
        <TableSettingsDrawer
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          columns={columns.map(c => ({ key: c.key, label: c.header }))}
          {...(sortableFields ? { sortFields: sortableFields } : {})}
          {...(defaultSortKey ? { defaultSort: { columnKey: defaultSortKey, direction: defaultSortDir } } : {})}
          {...(availableFilters ? { availableFilters } : {})}
          settings={tableSettings}
          onChange={updateTableSettings}
        />
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
          {effectiveColumns.map(c => (
            <th key={c.key} className={`p-3 ${c.align === 'right' ? 'text-right' : 'text-left'}`}>
              {c.sortable ? (
                <button
                  type="button"
                  onClick={() => toggleSort(c.key)}
                  // A button does not inherit the row's capitals, so sortable headers read "Name" beside "PHONE".
                  className={`inline-flex items-center gap-1 uppercase ${sortKey === c.key ? 'text-foreground' : ''} hover:text-foreground`}
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
        {visibleRows.map((row, rowIndex) => {
          const id = getRowId(row);
          const alt = tableSettings?.alternateRowColor && rowIndex % 2 === 1;
          return (
            <tr
              key={id}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`border-b last:border-b-0 hover:bg-muted/80 transition-colors ${onRowClick ? 'cursor-pointer' : ''} ${alt ? 'bg-muted/30' : ''}`}
            >
              {selectable && (
                <td className={`px-3 ${rowPadding}`}>
                  <input
                    type="checkbox"
                    checked={selected.has(id)}
                    onChange={() => toggleRow(id)}
                    aria-label={`Select ${id}`}
                  />
                </td>
              )}
              {effectiveColumns.map(c => (
                <td key={c.key} className={`px-3 ${rowPadding} ${c.align === 'right' ? 'text-right' : ''}`}>
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
