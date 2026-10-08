import { useState } from 'react';
import { Settings, SlidersHorizontal, X, GripVertical, Trash2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AppSelect } from '@/components/ui/select';
import type { TableSettings, TableSortRule, TableRowHeight } from '@/lib/tableSettings';

export type TableColumnDef = { key: string; label: string };

type Props = {
  open: boolean;
  onClose: () => void;
  columns: TableColumnDef[];
  availableFilters?: TableColumnDef[];
  settings: TableSettings;
  onChange: (next: TableSettings) => void;
};

const ROW_HEIGHTS: { value: TableRowHeight; label: string }[] = [
  { value: 'compact', label: 'Compact' },
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'spacious', label: 'Spacious' },
];
const PAGE_SIZES = [10, 25, 50, 100, 150];

function labelOf(columns: TableColumnDef[], key: string): string {
  return columns.find(c => c.key === key)?.label ?? key;
}

export function TableSettingsDrawer({ open, onClose, columns, availableFilters, settings, onChange }: Props) {
  const [dragCol, setDragCol] = useState<number | null>(null);
  const [dragFilter, setDragFilter] = useState<number | null>(null);

  if (!open) return null;

  function setSort(next: TableSortRule[]) { onChange({ ...settings, sort: next }); }
  function addSortRule() {
    const used = new Set(settings.sort.map(s => s.columnKey));
    const next = columns.find(c => !used.has(c.key));
    if (next) setSort([...settings.sort, { columnKey: next.key, direction: 'asc' }]);
  }
  function updateSortRule(i: number, patch: Partial<TableSortRule>) {
    setSort(settings.sort.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function removeSortRule(i: number) {
    setSort(settings.sort.filter((_, idx) => idx !== i));
  }

  function toggleColumn(key: string) {
    const visible = new Set(settings.visibleColumns);
    if (visible.has(key)) visible.delete(key); else visible.add(key);
    onChange({ ...settings, visibleColumns: [...visible] });
  }
  function reorderColumn(from: number, to: number) {
    if (from === to) return;
    const order = [...settings.columnOrder];
    const [moved] = order.splice(from, 1);
    if (moved) order.splice(to, 0, moved);
    onChange({ ...settings, columnOrder: order });
  }
  function reorderFilter(from: number, to: number) {
    if (from === to || !availableFilters) return;
    const order = [...settings.filterOrder];
    const [moved] = order.splice(from, 1);
    if (moved) order.splice(to, 0, moved);
    onChange({ ...settings, filterOrder: order });
  }

  const orderedColumns = settings.columnOrder.map(key => columns.find(c => c.key === key)).filter((c): c is TableColumnDef => !!c);
  const filterKeys = availableFilters
    ? [...settings.filterOrder, ...availableFilters.map(f => f.key).filter(k => !settings.filterOrder.includes(k))]
    : [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-foreground/30" onClick={onClose} />
      <div className="relative flex h-full w-[380px] max-w-[90vw] flex-col overflow-y-auto border-l bg-background shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Table settings</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-6 p-4">
          {/* Sort */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sort</h3>
            <div className="space-y-2">
              {settings.sort.map((rule, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground/50" />
                  <AppSelect className="h-8 flex-1 rounded-md border bg-background px-2 text-sm" value={rule.columnKey} onChange={e => updateSortRule(i, { columnKey: e.target.value })}>
                    {columns.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </AppSelect>
                  <AppSelect className="h-8 w-28 rounded-md border bg-background px-2 text-sm" value={rule.direction} onChange={e => updateSortRule(i, { direction: e.target.value === 'desc' ? 'desc' : 'asc' })}>
                    <option value="asc">Ascending</option>
                    <option value="desc">Descending</option>
                  </AppSelect>
                  <button type="button" onClick={() => removeSortRule(i)} aria-label="Remove sort rule" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {settings.sort.length < columns.length && (
                <Button type="button" variant="ghost" size="sm" className="gap-1 px-1 text-xs" onClick={addSortRule}>
                  <Plus className="h-3.5 w-3.5" /> Add sort
                </Button>
              )}
            </div>
          </section>

          {/* Rows */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rows</h3>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Rows per page</label>
                <AppSelect className="h-8 w-28 rounded-md border bg-background px-2 text-sm" value={String(settings.pageSize)} onChange={e => onChange({ ...settings, pageSize: Number(e.target.value) })}>
                  {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
                </AppSelect>
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Row height</label>
                <div className="flex gap-1.5">
                  {ROW_HEIGHTS.map(h => (
                    <button
                      key={h.value}
                      type="button"
                      onClick={() => onChange({ ...settings, rowHeight: h.value })}
                      className={`rounded-md border px-2.5 py-1 text-xs ${settings.rowHeight === h.value ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'}`}
                    >
                      {h.label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={settings.alternateRowColor} onChange={e => onChange({ ...settings, alternateRowColor: e.target.checked })} />
                Alternate row color
              </label>
            </div>
          </section>

          {/* Columns */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Columns</h3>
            <div className="space-y-1">
              {orderedColumns.map((col, i) => (
                <div
                  key={col.key}
                  draggable
                  onDragStart={() => setDragCol(i)}
                  onDragOver={e => e.preventDefault()}
                  onDrop={() => { if (dragCol !== null) reorderColumn(dragCol, i); setDragCol(null); }}
                  className="flex items-center gap-2 rounded px-1 py-1 hover:bg-muted/60"
                >
                  <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground/50" />
                  <input type="checkbox" checked={settings.visibleColumns.includes(col.key)} onChange={() => toggleColumn(col.key)} />
                  <span className="text-sm">{col.label}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Filters */}
          {availableFilters && availableFilters.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Filters</h3>
              <p className="mb-2 text-xs text-muted-foreground">Drag to set the order filters appear in on the filter bar.</p>
              <div className="space-y-1">
                {filterKeys.map((key, i) => (
                  <div
                    key={key}
                    draggable
                    onDragStart={() => setDragFilter(i)}
                    onDragOver={e => e.preventDefault()}
                    onDrop={() => { if (dragFilter !== null) reorderFilter(dragFilter, i); setDragFilter(null); }}
                    className="flex items-center gap-2 rounded px-1 py-1 hover:bg-muted/60"
                  >
                    <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground/50" />
                    <span className="text-sm">{labelOf(availableFilters, key)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="border-t px-4 py-3">
          <Button type="button" size="sm" onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  );
}

export function TableSettingsGearButton({ onClick }: { onClick: () => void }) {
  return (
    <div className="relative group">
      <button
        type="button"
        onClick={onClick}
        aria-label="Table settings"
        className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      >
        <Settings className="h-4 w-4" />
      </button>
      <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">Table settings</div>
    </div>
  );
}

// QBO-style labeled trigger ("⚙ Customize") for placing the Table Settings
// drawer's opener inline with a filter bar, instead of DataTable's own
// above-the-table toolbar row — see TransactionsPage for the pattern.
export function TableSettingsCustomizeButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
    >
      <SlidersHorizontal className="h-4 w-4" />
      Customize
    </button>
  );
}
