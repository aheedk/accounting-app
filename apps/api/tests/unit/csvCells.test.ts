import { describe, expect, it } from 'vitest';
import { rowsToCsv } from '../../src/services/reports/csvExportService.js';

// Security review 2026-10-21: a name or memo that came from a bank file or an
// emailed document must not run as a formula when the CSV is opened in Excel.
describe('rowsToCsv formula cells', () => {
  it('puts an apostrophe before text that starts like a formula, and leaves numbers alone', () => {
    const csv = rowsToCsv(
      [
        { name: '=HYPERLINK("http://x","Pay")', net: '-250.50' },
        { name: '@SUM(A1)', net: -12 },
        { name: 'Office Depot', net: '1,200.00' },
      ],
      ['name', 'net'],
    );
    expect(csv.split('\n')).toEqual([
      'name,net',
      `"'=HYPERLINK(""http://x"",""Pay"")",-250.50`,
      "'@SUM(A1),-12",
      'Office Depot,"1,200.00"',
      '',
    ]);
  });
});
