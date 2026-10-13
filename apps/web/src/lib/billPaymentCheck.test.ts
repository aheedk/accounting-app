import { describe, expect, it } from 'vitest';
import { billPaymentCheck } from './billPaymentCheck';

describe('billPaymentCheck', () => {
  const base = {
    checkNumber: '5519',
    paymentDate: '2026-10-13',
    amount: '350.00',
    bills: [
      { bill_number: 'P-1', due_date: '2026-10-01', amount: '100.00' },
      { bill_number: 'P-2', due_date: null, amount: '250.00' },
    ],
    bankAccountName: 'Operating',
    businessName: 'Acme LLC',
  };

  it('is made out to the name the vendor wants on checks, with its address under it', () => {
    const check = billPaymentCheck({
      ...base,
      vendor: {
        name: 'Paper Supply Co',
        name_on_checks: 'Paper Supply Company Inc',
        billing_address: { line1: '12 Mill Rd', city: 'Dayton', state: 'OH', postal_code: '45402' },
      },
    });
    expect(check.payeeName).toBe('Paper Supply Company Inc');
    expect(check.mailingAddress).toEqual(['Paper Supply Company Inc', '12 Mill Rd', 'Dayton, OH, 45402']);
    expect(check.paymentDate).toBe('10/13/2026');
    expect(check.amount).toBe('350.00');
  });

  it('lists the bills it pays on the stub', () => {
    const check = billPaymentCheck({ ...base, vendor: { name: 'Paper Supply Co' } });
    expect(check.payeeName).toBe('Paper Supply Co');
    expect(check.lineHeaders).toEqual(['Bill no.', 'Due date', 'Amount paid']);
    expect(check.lines).toEqual([
      { accountLabel: 'P-1', description: '10/01/2026', amount: '100.00' },
      { accountLabel: 'P-2', description: '', amount: '250.00' },
    ]);
  });

  it('shows a dash for a check with no number yet', () => {
    expect(billPaymentCheck({ ...base, checkNumber: null, vendor: { name: 'Paper Supply Co' } }).checkNumber).toBe('—');
  });
});
