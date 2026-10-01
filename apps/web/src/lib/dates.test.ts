import { describe, expect, it } from 'vitest';
import { normalizeDateInput } from './dates';

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
