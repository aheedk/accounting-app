import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computePresetRange } from './GeneralLedgerPage';

// The fiscal-year presets were flagged in the 2026-10-01 meeting follow-ups as
// "not tested and their definitions still need filling in" -- they previously
// just duplicated the calendar-year presets regardless of the business's own
// businesses.fiscal_year_start_month.
describe('General Ledger fiscal year presets', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('matches the calendar year when the fiscal year starts in January', () => {
    vi.setSystemTime(new Date(2026, 6, 15));
    expect(computePresetRange('this-fiscal-year', 1)).toEqual({ start: '2026-01-01', end: '2026-12-31' });
    expect(computePresetRange('last-fiscal-year', 1)).toEqual({ start: '2025-01-01', end: '2025-12-31' });
  });

  it('computes a fiscal year starting mid-calendar-year (e.g. April)', () => {
    vi.setSystemTime(new Date(2026, 6, 15)); // July 15, 2026 -- inside the FY that started Apr 1, 2026
    expect(computePresetRange('this-fiscal-year', 4)).toEqual({ start: '2026-04-01', end: '2027-03-31' });
    expect(computePresetRange('this-fiscal-year-to-date', 4)).toEqual({ start: '2026-04-01', end: '2026-07-15' });
    expect(computePresetRange('last-fiscal-year', 4)).toEqual({ start: '2025-04-01', end: '2026-03-31' });
    // Same day-of-fiscal-year offset (105 days in), mirrored onto the prior fiscal year.
    expect(computePresetRange('last-fiscal-year-to-date', 4)).toEqual({ start: '2025-04-01', end: '2025-07-15' });
  });

  it('rolls back into the previous calendar year before the fiscal year start month', () => {
    vi.setSystemTime(new Date(2026, 1, 10)); // Feb 10, 2026, before an April fiscal start
    expect(computePresetRange('this-fiscal-year', 4)).toEqual({ start: '2025-04-01', end: '2026-03-31' });
    expect(computePresetRange('this-fiscal-year-to-date', 4)).toEqual({ start: '2025-04-01', end: '2026-02-10' });
  });
});
