import { describe, expect, it } from 'vitest';
import { amountInWords, buildChecksPdf, csvCell, type CheckDocInput } from './download';

describe('amountInWords', () => {
  it('matches the check-writing convention from the spec', () => {
    expect(amountInWords('690.20')).toBe('Six hundred ninety and 20/100');
  });

  it('handles whole dollars, a single dollar, and zero cents', () => {
    expect(amountInWords('1.00')).toBe('One and 00/100');
    expect(amountInWords('42.00')).toBe('Forty two and 00/100');
    expect(amountInWords('0.00')).toBe('Zero and 00/100');
  });

  it('spells out thousands and preserves a leading zero on cents', () => {
    expect(amountInWords('1500.05')).toBe('One thousand five hundred and 05/100');
  });

  it('rounds sub-cent floating point noise before formatting', () => {
    expect(amountInWords(19.99)).toBe('Nineteen and 99/100');
  });
});

describe('buildChecksPdf', () => {
  const check = (checkNumber: string, lines: number): CheckDocInput => ({
    checkNumber,
    paymentDate: '10/13/2026',
    payeeName: 'Paper Supply Co',
    mailingAddress: ['Paper Supply Co', '12 Mill Rd', 'Dayton, OH, 45402'],
    amount: '1,350.00',
    bankAccountName: 'Operating',
    bankAccountLastFour: '4411',
    memo: 'October',
    lineHeaders: ['Bill no.', 'Due date', 'Amount paid'],
    lines: Array.from({ length: lines }, (_, i) => ({ accountLabel: `P-${i + 1}`, description: '10/01/2026', amount: '100.00' })),
    businessName: 'Acme LLC',
  });

  it('puts each check on a page of its own, on check stock or plain paper', () => {
    expect(buildChecksPdf([check('5519', 2), check('5520', 1)], 'stock').getNumberOfPages()).toBe(2);
    expect(buildChecksPdf([check('5519', 2), check('5520', 1)], 'plain').getNumberOfPages()).toBe(2);
  });

  it('keeps a check with many bills on one page of check stock', () => {
    // The stub is 3.5 inches; the bills that do not fit are counted, not run over the next stub.
    expect(buildChecksPdf([check('5519', 30)], 'stock').getNumberOfPages()).toBe(1);
  });
});

// Security review 2026-10-21: text from a bank file or an emailed document must not run as a formula in Excel.
describe('csvCell', () => {
  it('writes text that starts like a formula with a leading apostrophe', () => {
    expect(csvCell('=HYPERLINK("http://x","Pay")')).toBe(`"'=HYPERLINK(""http://x"",""Pay"")"`);
    expect(csvCell('+1+cmd')).toBe("'+1+cmd");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tTab')).toBe("'\tTab");
  });

  it('leaves amounts, dates and ordinary text as they are', () => {
    expect(csvCell('-1,234.50')).toBe('"-1,234.50"');
    expect(csvCell('-250.5')).toBe('-250.5');
    expect(csvCell('2026-10-21')).toBe('2026-10-21');
    expect(csvCell('Office Depot')).toBe('Office Depot');
  });
});
