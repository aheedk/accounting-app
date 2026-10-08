import { describe, expect, it } from 'vitest';
import { defaultTableSettings, normalizeTableSettings, moveTableColumn } from './tableSettings';

const COLS = ['date', 'type', 'ref_no', 'amount', 'status'];

describe('generic table settings', () => {
  it('repairs stale column keys and preserves valid settings', () => {
    const settings = normalizeTableSettings({
      columnOrder: ['amount', 'unknown', 'date', 'amount'],
      visibleColumns: ['amount', 'unknown'],
      sort: [{ columnKey: 'amount', direction: 'desc' }, { columnKey: 'unknown', direction: 'asc' }],
      pageSize: 100,
      rowHeight: 'roomy',
      alternateRowColor: true,
    }, COLS);

    expect(settings.columnOrder).toEqual(['amount', 'date', 'type', 'ref_no', 'status']);
    expect(settings.visibleColumns).toEqual(['amount']);
    expect(settings.sort).toEqual([{ columnKey: 'amount', direction: 'desc' }]);
    expect(settings.pageSize).toBe(100);
    expect(settings.rowHeight).toBe('roomy');
    expect(settings.alternateRowColor).toBe(true);
  });

  it('falls back to defaults for an invalid page size and empty visibility', () => {
    const settings = normalizeTableSettings({ pageSize: 999, visibleColumns: [] }, COLS);
    expect(settings.pageSize).toBe(25);
    expect(settings.visibleColumns).toEqual(COLS);
  });

  it('defaults to every column visible, in the given order', () => {
    const defaults = defaultTableSettings(COLS);
    expect(defaults.columnOrder).toEqual(COLS);
    expect(defaults.visibleColumns).toEqual(COLS);
    expect(defaults.sort).toEqual([]);
    expect(defaults.hiddenFilters).toEqual([]);
  });

  it('preserves hiddenFilters', () => {
    const settings = normalizeTableSettings({ hiddenFilters: ['memo', 42] }, COLS);
    expect(settings.hiddenFilters).toEqual(['memo']);
  });

  it('moves a column without mutating the original order', () => {
    const moved = moveTableColumn(COLS, 'type', -1);
    expect(moved.slice(0, 2)).toEqual(['type', 'date']);
    expect(COLS.slice(0, 2)).toEqual(['date', 'type']);
    expect(moveTableColumn(COLS, 'date', -1)).toBe(COLS);
  });
});
