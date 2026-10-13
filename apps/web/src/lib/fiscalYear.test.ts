import { describe, expect, it } from 'vitest';
import { fiscalYearRange } from './fiscalYear';

describe('fiscalYearRange', () => {
  it('is the calendar year for a company that starts in January', () => {
    expect(fiscalYearRange('2026-10-13', 1)).toEqual({ start: '2026-01-01', end: '2026-12-31' });
  });

  it('runs July to June for a July company', () => {
    expect(fiscalYearRange('2026-10-13', 7)).toEqual({ start: '2026-07-01', end: '2027-06-30' });
    // Before July the year in progress began the July before.
    expect(fiscalYearRange('2026-03-15', 7)).toEqual({ start: '2025-07-01', end: '2026-06-30' });
    expect(fiscalYearRange('2026-07-01', 7)).toEqual({ start: '2026-07-01', end: '2027-06-30' });
    expect(fiscalYearRange('2026-06-30', 7)).toEqual({ start: '2025-07-01', end: '2026-06-30' });
  });

  it('ends on the right day when the year ends in February', () => {
    expect(fiscalYearRange('2027-06-01', 3)).toEqual({ start: '2027-03-01', end: '2028-02-29' });
    expect(fiscalYearRange('2026-06-01', 3)).toEqual({ start: '2026-03-01', end: '2027-02-28' });
  });

  it('gives the year before with a shift of -1', () => {
    expect(fiscalYearRange('2026-10-13', 7, -1)).toEqual({ start: '2025-07-01', end: '2026-06-30' });
    expect(fiscalYearRange('2026-10-13', 1, -1)).toEqual({ start: '2025-01-01', end: '2025-12-31' });
  });

  it('falls back to January for a month that is not one', () => {
    expect(fiscalYearRange('2026-10-13', 0)).toEqual({ start: '2026-01-01', end: '2026-12-31' });
    expect(fiscalYearRange('2026-10-13', 13)).toEqual({ start: '2026-01-01', end: '2026-12-31' });
  });
});
