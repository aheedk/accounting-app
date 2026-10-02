import { describe, expect, it } from 'vitest';
import {
  defaultGeneralLedgerPreferences,
  moveGeneralLedgerColumn,
  normalizeGeneralLedgerPreferences,
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
