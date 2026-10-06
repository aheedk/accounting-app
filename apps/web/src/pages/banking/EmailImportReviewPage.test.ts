import { describe, expect, it } from 'vitest';
import { bestVendorMatch } from './EmailImportReviewPage';

// 2026-10-01 meeting follow-up: the Name column on a bank statement review
// should match what the AI pulled off the statement ("Duke Power") against
// the client's existing vendors ("Duke Energy") instead of leaving it as
// whatever the bank printed.
describe('bestVendorMatch', () => {
  const vendors = [
    { id: '1', name: 'Duke Energy' },
    { id: '2', name: 'Staples Inc' },
    { id: '3', name: 'Verizon Wireless' },
  ];

  it('matches a renamed vendor by shared, meaningful words', () => {
    expect(bestVendorMatch('Duke Power', vendors)).toBe('Duke Energy');
  });

  it('prefers an exact (case-insensitive) match over a fuzzy one', () => {
    expect(bestVendorMatch('staples inc', vendors)).toBe('Staples Inc');
  });

  it('ignores common business suffixes when comparing', () => {
    expect(bestVendorMatch('Staples', vendors)).toBe('Staples Inc');
  });

  it('returns null for an unrelated name rather than guessing', () => {
    expect(bestVendorMatch('Acme Plumbing', vendors)).toBeNull();
  });

  it('returns null for blank input or an empty vendor list', () => {
    expect(bestVendorMatch('', vendors)).toBeNull();
    expect(bestVendorMatch('Duke Power', [])).toBeNull();
  });
});
