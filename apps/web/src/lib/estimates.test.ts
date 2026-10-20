import { describe, expect, it } from 'vitest';
import { estimateCanInvoice, estimateShownStatus } from './estimates';

// Item 17: Expired is shown, not stored (docs/specs/2026-10-20-estimates-design.md).
describe('estimate status', () => {
  it('reads Expired only while pending past its expiration date', () => {
    expect(estimateShownStatus({ status: 'pending', expiration_date: '2026-10-19' }, '2026-10-20')).toBe('expired');
    expect(estimateShownStatus({ status: 'pending', expiration_date: '2026-10-20' }, '2026-10-20')).toBe('pending');
    expect(estimateShownStatus({ status: 'pending', expiration_date: null }, '2026-10-20')).toBe('pending');
    expect(estimateShownStatus({ status: 'accepted', expiration_date: '2026-01-01' }, '2026-10-20')).toBe('accepted');
  });

  it('makes an invoice from a pending or accepted estimate only', () => {
    expect(['pending', 'accepted', 'rejected', 'closed'].map(status => estimateCanInvoice({ status: status as 'pending' })))
      .toEqual([true, true, false, false]);
  });
});
