import { describe, expect, it } from 'vitest';
import {
  defaultGeneralLedgerPreferences,
  moveGeneralLedgerColumn,
  nextColumnSort,
  normalizeGeneralLedgerPreferences,
  sortLedgerLines,
} from './generalLedgerCustomization';

describe('General Ledger customization preferences', () => {
  it('repairs stale columns and preserves valid settings', () => {
    const preferences = normalizeGeneralLedgerPreferences({
      columnOrder: ['memo', 'unknown', 'date', 'memo'],
      visibleColumns: ['memo', 'unknown'],
      sortDirection: 'newest',
      density: 'compact',
      showAccountTotals: false,
    });

    // Saved columns keep their order; every other column follows in the default order.
    expect(preferences.columnOrder).toEqual([
      'memo', 'date', 'transaction', 'reference', 'adj', 'name', 'split',
      'debit', 'credit', 'amount', 'balance', 'class', 'createDate', 'createdBy', 'lastModified',
    ]);
    expect(preferences.visibleColumns).toEqual(['memo']);
    expect(preferences.sortDirection).toBe('newest');
    expect(preferences.density).toBe('compact');
    expect(preferences.showAccountTotals).toBe(false);
    expect(preferences.showReportTotal).toBe(true);
  });

  it('offers debit and credit columns but leaves them hidden by default', () => {
    const defaults = defaultGeneralLedgerPreferences();
    expect(defaults.columnOrder).toEqual(expect.arrayContaining(['debit', 'credit', 'class', 'createDate']));
    expect(defaults.visibleColumns).toEqual([
      'date', 'transaction', 'reference', 'adj', 'name', 'memo', 'split', 'amount', 'balance',
    ]);
  });

  it('keeps at least the default columns when saved visibility is invalid', () => {
    expect(normalizeGeneralLedgerPreferences({ visibleColumns: [] }).visibleColumns)
      .toEqual(defaultGeneralLedgerPreferences().visibleColumns);
  });

  it('moves columns without mutating the original order', () => {
    const original = defaultGeneralLedgerPreferences().columnOrder;
    const moved = moveGeneralLedgerColumn(original, 'transaction', -1);
    expect(moved.slice(0, 2)).toEqual(['transaction', 'date']);
    expect(original.slice(0, 2)).toEqual(['date', 'transaction']);
    expect(moveGeneralLedgerColumn(original, 'date', -1)).toBe(original);
  });
});

describe('General Ledger column sorting', () => {
  it('cycles a heading through ascending, descending and off', () => {
    const first = nextColumnSort(null, 'name');
    expect(first).toEqual({ column: 'name', direction: 'asc' });
    const second = nextColumnSort(first, 'name');
    expect(second).toEqual({ column: 'name', direction: 'desc' });
    expect(nextColumnSort(second, 'name')).toBeNull();
    // Another heading starts over at ascending.
    expect(nextColumnSort(second, 'split')).toEqual({ column: 'split', direction: 'asc' });
  });

  it('sorts text without regard to case and reads the numbers inside it', () => {
    const lines = [{ v: 'JE-10' }, { v: 'je-9' }, { v: 'JE-100' }];
    expect(sortLedgerLines(lines, 'asc', l => l.v).map(l => l.v)).toEqual(['je-9', 'JE-10', 'JE-100']);
    expect(sortLedgerLines(lines, 'desc', l => l.v).map(l => l.v)).toEqual(['JE-100', 'JE-10', 'je-9']);
  });

  it('sorts amounts as numbers', () => {
    const lines = [{ v: 100 }, { v: -5 }, { v: 20 }];
    expect(sortLedgerLines(lines, 'asc', l => l.v).map(l => l.v)).toEqual([-5, 20, 100]);
  });

  it('keeps ties in the order they came in and puts blanks last both ways', () => {
    const lines = [
      { id: 1, v: 'Rent' }, { id: 2, v: '' }, { id: 3, v: 'Acme' }, { id: 4, v: 'Rent' },
    ];
    expect(sortLedgerLines(lines, 'asc', l => l.v).map(l => l.id)).toEqual([3, 1, 4, 2]);
    expect(sortLedgerLines(lines, 'desc', l => l.v).map(l => l.id)).toEqual([1, 4, 3, 2]);
    // The list handed in is left as it was.
    expect(lines.map(l => l.id)).toEqual([1, 2, 3, 4]);
  });
});
