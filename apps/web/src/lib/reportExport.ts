// Shared layout for everything the app exports or prints: a header naming the
// company, the report and its period; amounts as right-aligned numbers; bold
// section and total rows; and a footer with when it was produced and the page
// number. Pages hand over plain rows of text, so the structure is worked out
// from the data here rather than described by every caller.

export type ExportMeta = {
  /** Report name, e.g. "Profit & Loss". */
  title?: string;
  /** Period or as-of line, e.g. "January 1, 2026 - March 31, 2026". */
  subtitle?: string;
  /**
   * Headings and rows only -- no title block or footer. For files meant to be
   * filled in and uploaded again (import templates), which must start at the
   * column headings.
   */
  bare?: boolean;
};

let exportCompany = '';

/** The company whose books are open; AppShell keeps this current. */
export function setExportCompany(name: string | null | undefined): void {
  exportCompany = name ?? '';
}

export function getExportCompany(): string {
  return exportCompany;
}

export function generatedLine(now: Date = new Date()): string {
  const date = now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const time = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `Generated ${date} at ${time}`;
}

const NUMBER_LIKE = /^\(?-?\$?\d[\d,]*(\.\d+)?\)?%?$/;
// Columns that hold identifiers even when every value happens to be digits.
// Judged by the heading's last word, so "Account Balance" is still money and "Tax ID" is not.
const IDENTIFIER_HEADER = /(^|\s)(no\.?|num|number|#|code|id|sku|ref|reference|check|zip|phone|year|account|acct|ein|ssn|tin)\.?$/i;
const MONEY_HEADER = /(amount|total|balance|debit|credit|price|cost|paid|due|open|remaining|subtotal|tax|value|current|net|gross|income|expense|payment|\d+\s*[-–+]\s*\d*)/i;

/** "1,234.50", "(1,234.50)", "$12" -> number; anything else -> null. */
export function parseAmount(text: string): number | null {
  const trimmed = text.trim();
  if (!NUMBER_LIKE.test(trimmed) || trimmed.endsWith('%')) return null;
  const negative = trimmed.startsWith('(') || trimmed.includes('-');
  const value = Number(trimmed.replace(/[()$,-]/g, ''));
  if (Number.isNaN(value)) return null;
  return negative ? -value : value;
}

/**
 * Which columns are amounts. A column qualifies when every filled cell reads
 * as a number and either some carry decimals or the heading names money --
 * and the heading is not an identifier (invoice no., account code, year...).
 */
export function amountColumns(headers: string[], rows: string[][]): boolean[] {
  return headers.map((header, index) => {
    if (IDENTIFIER_HEADER.test(header)) return false;
    const cells = rows.map(row => (row[index] ?? '').trim()).filter(cell => cell !== '');
    if (cells.length === 0) return false;
    if (!cells.every(cell => parseAmount(cell) !== null)) return false;
    return cells.some(cell => cell.includes('.')) || MONEY_HEADER.test(header);
  });
}

export type RowKind = 'total' | 'section' | 'normal';

const TOTAL_LABEL = /^(report\s+)?(grand\s+)?(sub)?total\b|^total\s|^net\s|^gross\s(profit|margin)|^account total$/i;

/** A total line, a section heading (a label with nothing else in the row), or an ordinary row. */
export function rowKind(row: string[]): RowKind {
  const filled = row.map(cell => cell.trim()).filter(cell => cell !== '');
  if (filled.some(cell => TOTAL_LABEL.test(cell))) return 'total';
  if (filled.length === 1 && row.length > 1 && parseAmount(filled[0]!) === null) return 'section';
  return 'normal';
}

export function fmtExportAmount(value: number): string {
  const text = Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return value < 0 ? `-${text}` : text;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export type PrintReportInput = ExportMeta & {
  title: string;
  headers: string[];
  rows: string[][];
};

/** The printable page for a report, as an HTML document. Exposed for testing. */
export function buildPrintHtml(input: PrintReportInput, now: Date = new Date()): string {
  const company = getExportCompany();
  const rows = input.rows.filter(row => row.some(cell => cell.trim() !== ''));
  const amounts = amountColumns(input.headers, rows);
  const landscape = input.headers.length > 6;
  const running = [company, input.title].filter(Boolean).join(' · ');

  const head = input.headers
    .map((header, index) => `<th class="${amounts[index] ? 'num' : ''}">${escapeHtml(header)}</th>`)
    .join('');
  const body = rows.map(row => {
    const kind = rowKind(row);
    const cells = input.headers.map((_, index) => {
      const raw = (row[index] ?? '').trim();
      const amount = amounts[index] ? parseAmount(raw) : null;
      const text = amount !== null ? fmtExportAmount(amount) : raw;
      return `<td class="${amounts[index] ? 'num' : ''}">${escapeHtml(text)}</td>`;
    }).join('');
    return `<tr class="${kind}">${cells}</tr>`;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(running)}</title><style>
@page { size: ${landscape ? 'landscape' : 'portrait'}; margin: 14mm 12mm 18mm;
  @bottom-left { content: "${running.replace(/"/g, '\\"')}"; font: 8pt Arial, sans-serif; color: #666; }
  @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8pt Arial, sans-serif; color: #666; } }
body { font-family: Arial, Helvetica, sans-serif; font-size: 10px; color: #111; margin: 0; }
header { text-align: center; margin-bottom: 14px; }
header .company { font-size: 16px; font-weight: 700; }
header .title { font-size: 13px; font-weight: 600; margin-top: 2px; }
header .subtitle { font-size: 10.5px; color: #444; margin-top: 2px; }
table { width: 100%; border-collapse: collapse; }
thead { display: table-header-group; }
th { text-align: left; padding: 5px 7px; border-top: 1px solid #111; border-bottom: 1px solid #111; font-size: 9px; text-transform: uppercase; letter-spacing: .03em; }
td { padding: 4px 7px; border-bottom: 1px solid #e3e3e3; vertical-align: top; }
.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
tr { page-break-inside: avoid; }
tr.total td { font-weight: 700; border-top: 1px solid #111; border-bottom: 1px solid #111; }
tr.section td { font-weight: 700; background: #f3f3f3; }
footer { margin-top: 12px; font-size: 8.5px; color: #666; }
</style></head><body>
<header>${company ? `<div class="company">${escapeHtml(company)}</div>` : ''}<div class="title">${escapeHtml(input.title)}</div>${input.subtitle ? `<div class="subtitle">${escapeHtml(input.subtitle)}</div>` : ''}</header>
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
<footer>${escapeHtml(generatedLine(now))}</footer>
<script>window.onload=function(){window.print()}</script>
</body></html>`;
}

/** Open the print dialog (print or "Save as PDF") for a report. */
export function printReport(input: PrintReportInput): void {
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(buildPrintHtml(input));
  win.document.close();
}
