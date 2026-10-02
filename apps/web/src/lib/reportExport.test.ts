import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { buildPdf, downloadAsExcel } from './download';
import { amountColumns, buildPrintHtml, parseAmount, rowKind, setExportCompany } from './reportExport';

const headers = ['Code', 'Account', 'Invoice No.', 'Amount'];
const rows = [
  ['', 'Revenue', '', ''],
  ['4010', 'Sales <Retail>', '1001', '6843.0000'],
  ['4020', 'Service', '1002', '(250.5)'],
  ['', '', '', ''],
  ['', 'Total Revenue', '', '6,592.50'],
];

describe('report export layout', () => {
  beforeEach(() => { setExportCompany('Blue Widget Co.'); });
  afterEach(() => { vi.restoreAllMocks(); setExportCompany(''); });

  it('reads amounts, including negatives in parentheses, and leaves other text alone', () => {
    expect(parseAmount('1,234.50')).toBe(1234.5);
    expect(parseAmount('(250.5)')).toBe(-250.5);
    expect(parseAmount('-9.0000')).toBe(-9);
    expect(parseAmount('2026-01-31')).toBeNull();
    expect(parseAmount('INV-1001')).toBeNull();
    expect(parseAmount('12%')).toBeNull();
  });

  it('treats money columns as amounts but not codes or document numbers', () => {
    expect(amountColumns(headers, rows)).toEqual([false, false, false, true]);
    // Whole numbers count as money only under a money heading.
    expect(amountColumns(['Qty', 'Total'], [['3', '90'], ['2', '60']])).toEqual([false, true]);
    expect(amountColumns(['Tax ID', 'Account Balance'], [['123456789', '10.00']])).toEqual([false, true]);
  });

  it('recognises section headings and total lines', () => {
    expect(rows.map(rowKind)).toEqual(['section', 'normal', 'normal', 'normal', 'total']);
    expect(rowKind(['1020', 'Operating Bank', 'Account Total', '100.00'])).toBe('total');
    expect(rowKind(['', 'Net Income', '5.00'])).toBe('total');
  });

  it('prints with the company, report name, period, a generated line and page numbers', () => {
    const html = buildPrintHtml(
      { title: 'Profit & Loss', subtitle: 'January 1, 2026 – March 31, 2026', headers, rows },
      new Date(2026, 9, 1, 15, 25),
    );
    expect(html).toContain('<div class="company">Blue Widget Co.</div>');
    expect(html).toContain('<div class="title">Profit &amp; Loss</div>');
    expect(html).toContain('January 1, 2026 – March 31, 2026');
    expect(html).toContain('counter(page) " of " counter(pages)');
    expect(html).toMatch(/<footer>Generated .*2026/);
    // Amounts are right-aligned and formatted; text is escaped; blank rows are dropped.
    expect(html).toContain('<td class="num">6,843.00</td>');
    expect(html).toContain('<td class="num">-250.50</td>');
    expect(html).toContain('Sales &lt;Retail&gt;');
    expect(html).toContain('<tr class="total">');
    expect(html).toContain('<tr class="section">');
    expect(html.match(/<tr class=/g)).toHaveLength(4);
  });

  it('writes Excel with a title block, numeric amounts and a generated line', () => {
    let sheet: XLSX.WorkSheet | undefined;
    let file = '';
    vi.spyOn(XLSX, 'writeFile').mockImplementation((workbook, name) => {
      sheet = workbook.Sheets[workbook.SheetNames[0]!];
      file = String(name);
    });

    downloadAsExcel(headers, rows, 'pnl', { title: 'Profit & Loss', subtitle: 'Q1 2026' });

    expect(file).toBe('pnl.xlsx');
    const grid = XLSX.utils.sheet_to_json<(string | number)[]>(sheet!, { header: 1, blankrows: true });
    expect(grid[0]).toEqual(['Blue Widget Co.']);
    expect(grid[1]).toEqual(['Profit & Loss']);
    expect(grid[2]).toEqual(['Q1 2026']);
    expect(grid[4]).toEqual(headers);
    expect(grid[6]).toEqual(['4010', 'Sales <Retail>', '1001', 6843]);
    expect(grid[7]).toEqual(['4020', 'Service', '1002', -250.5]);
    expect(String(grid.at(-1)![0])).toMatch(/^Generated /);
    // Amounts are numbers with a money format; the invoice number stays text.
    expect(sheet!['D7']).toMatchObject({ t: 'n', v: 6843, z: '#,##0.00' });
    expect(sheet!['C7']).toMatchObject({ t: 's', v: '1001' });
  });

  it('writes an import template with nothing but headings and rows', () => {
    let sheet: XLSX.WorkSheet | undefined;
    vi.spyOn(XLSX, 'writeFile').mockImplementation(workbook => { sheet = workbook.Sheets[workbook.SheetNames[0]!]; });

    downloadAsExcel(['Name', 'Code'], [['Cash', '1000']], 'coa-template', { bare: true });

    expect(XLSX.utils.sheet_to_json(sheet!, { header: 1 })).toEqual([['Name', 'Code'], ['Cash', '1000']]);
  });

  it('builds a PDF with the header on the page and a page-number footer', () => {
    const text = buildPdf(headers, rows, 'Profit & Loss', { subtitle: 'Q1 2026' }).output();

    expect(text).toContain('Blue Widget Co.');
    expect(text).toContain('Q1 2026');
    expect(text).toContain('Page 1 of 1');
    expect(text).toContain('6,843.00');
  });
});
