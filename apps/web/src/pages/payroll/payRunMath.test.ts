import { describe, expect, it } from 'vitest';
import { blankPayLine, netPay, payRunTotals, withHours, withPayrollTaxes } from './payRunMath';

describe('pay run arithmetic', () => {
  it('works out Social Security and Medicare for both sides from the gross', () => {
    const line = withPayrollTaxes(blankPayLine('e1'), '2000.00');
    expect(line).toMatchObject({
      gross: '2000.00', fica_employee: '124.00', fica_employer: '124.00',
      medicare_employee: '29.00', medicare_employer: '29.00',
    });
  });

  it('turns hours into gross at the hourly rate', () => {
    const line = withHours(blankPayLine('e1'), '80', 25);
    expect(line.gross).toBe('2000.00');
    expect(line.fica_employee).toBe('124.00');
    // No rate on file: the hours are kept and gross is left for the user.
    expect(withHours(blankPayLine('e1'), '80', 0).gross).toBe('');
  });

  it('nets pay as gross less everything withheld from the employee', () => {
    const line = { ...withPayrollTaxes(blankPayLine('e1'), '2000.00'), federal_wh: '200.00', state_wh: '50.00', other_deductions: '25.00' };
    expect(netPay(line)).toBeCloseTo(2000 - 200 - 50 - 124 - 29 - 25, 2);
  });

  it('totals only the lines that are included and have pay', () => {
    const a = { ...withPayrollTaxes(blankPayLine('a'), '1000.00'), federal_wh: '100.00' };
    const b = { ...withPayrollTaxes(blankPayLine('b'), '500.00'), included: false };
    const c = blankPayLine('c');
    const totals = payRunTotals([a, b, c]);
    expect(totals.count).toBe(1);
    expect(totals.gross).toBe(1000);
    expect(totals.net).toBeCloseTo(1000 - 100 - 62 - 14.5, 2);
    expect(totals.employerTaxes).toBeCloseTo(62 + 14.5, 2);
    expect(totals.negativeNet).toBe(false);
    expect(payRunTotals([{ ...a, federal_wh: '5000.00' }]).negativeNet).toBe(true);
  });
});
