import { describe, expect, it } from 'vitest';
import { fiscalYearBoundsLocal, fmtDateText, normalizeDateInput, parseDateText } from './dates';

describe('normalizeDateInput', () => {
  it('reads a two-digit year as this century', () => {
    // A browser date box left on year "26" reports 0026.
    expect(normalizeDateInput('0026-10-01', '2026-01-01')).toBe('2026-10-01');
    expect(normalizeDateInput('0005-03-09', '')).toBe('2005-03-09');
    expect(normalizeDateInput('0099-12-31', '')).toBe('2099-12-31');
  });

  it('leaves a full year alone', () => {
    expect(normalizeDateInput('2026-10-01', '')).toBe('2026-10-01');
    expect(normalizeDateInput('1998-02-28', '')).toBe('1998-02-28');
  });

  it('falls back to the last good value for a year it cannot place or a date that does not exist', () => {
    expect(normalizeDateInput('0202-10-01', '2026-01-01')).toBe('2026-01-01');
    expect(normalizeDateInput('2026-06-31', '2026-06-30')).toBe('2026-06-30');
    expect(normalizeDateInput('garbage', '2026-06-30')).toBe('2026-06-30');
  });

  it('keeps an emptied box empty', () => {
    expect(normalizeDateInput('', '2026-06-30')).toBe('');
  });
});

describe('parseDateText', () => {
  it('reads the month first, with any separator', () => {
    expect(parseDateText('10/12/2026', '')).toBe('2026-10-12');
    expect(parseDateText('1/5/2026', '')).toBe('2026-01-05');
    expect(parseDateText('10-12-2026', '')).toBe('2026-10-12');
    expect(parseDateText('10.12.2026', '')).toBe('2026-10-12');
    expect(parseDateText(' 10/12/2026 ', '')).toBe('2026-10-12');
  });

  it('reads a two-digit year as this century, and no year as this year', () => {
    expect(parseDateText('10/12/26', '')).toBe('2026-10-12');
    expect(parseDateText('3/9', '')).toBe(`${new Date().getFullYear()}-03-09`);
  });

  it('reads digits typed without separators', () => {
    expect(parseDateText('10122026', '')).toBe('2026-10-12');
    expect(parseDateText('101226', '')).toBe('2026-10-12');
    expect(parseDateText('1012', '')).toBe(`${new Date().getFullYear()}-10-12`);
  });

  it('still takes a date already in the stored form', () => {
    expect(parseDateText('2026-10-12', '')).toBe('2026-10-12');
  });

  it('keeps the last good date when what was typed is not a date', () => {
    expect(parseDateText('13/45/2026', '2026-06-30')).toBe('2026-06-30');
    expect(parseDateText('6/31/2026', '2026-06-30')).toBe('2026-06-30');
    expect(parseDateText('tomorrow', '2026-06-30')).toBe('2026-06-30');
    expect(parseDateText('10/12/202', '2026-06-30')).toBe('2026-06-30');
    expect(parseDateText('12345', '2026-06-30')).toBe('2026-06-30');
  });

  it('leaves an emptied box empty', () => {
    expect(parseDateText('', '2026-06-30')).toBe('');
  });
});

describe('fmtDateText', () => {
  it('shows the month first', () => {
    expect(fmtDateText('2026-10-12')).toBe('10/12/2026');
    expect(fmtDateText('')).toBe('');
  });
});

describe('fiscalYearBoundsLocal', () => {
  it('reduces to the plain calendar year when the fiscal year starts in January', () => {
    expect(fiscalYearBoundsLocal(1, new Date(2026, 5, 12))).toEqual({ start: '2026-01-01', end: '2026-12-31' });
  });

  it('gives July 1 to June 30 for a fiscal year that starts in July, on either side of the boundary', () => {
    // Today in the second half of the fiscal year (e.g. March) -- the fiscal year started last July.
    expect(fiscalYearBoundsLocal(7, new Date(2026, 2, 15))).toEqual({ start: '2025-07-01', end: '2026-06-30' });
    // Today in the first half (e.g. September) -- the fiscal year started this July.
    expect(fiscalYearBoundsLocal(7, new Date(2026, 8, 15))).toEqual({ start: '2026-07-01', end: '2027-06-30' });
  });
});
