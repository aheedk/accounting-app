import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  amountColumns, fmtExportAmount, generatedLine, getExportCompany, parseAmount, rowKind,
  type ExportMeta,
} from './reportExport';

function filledRows(rows: string[][]): string[][] {
  return rows.filter(row => row.some(cell => cell.trim() !== ''));
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Plain CSV download — no dialog, no title/company header rows (unlike
 * downloadAsExcel): the user clicks the icon and the file lands immediately,
 * matching QBO's "Export to CSV" on a transactions list.
 */
export function downloadAsCsv(headers: string[], rows: string[][], filename: string): void {
  const body = filledRows(rows);
  const csv = [headers, ...body].map(row => row.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Excel export. The sheet opens with the company, report name and period,
 * then the table, then a "Generated ..." line. Amount columns are written as
 * real numbers (so they can be summed) with a #,##0.00 format; everything else
 * stays text, so codes and document numbers keep their leading zeros.
 */
export function downloadAsExcel(headers: string[], rows: string[][], filename: string, meta: ExportMeta = {}): void {
  const body = filledRows(rows);
  const amounts = amountColumns(headers, body);
  const company = getExportCompany();
  const titleRows = meta.bare
    ? []
    : [company, meta.title ?? '', meta.subtitle ?? ''].filter(line => line !== '').map(line => [line]);
  const lead: string[][] = titleRows.length > 0 ? [...titleRows, []] : [];

  const table: (string | number)[][] = body.map(row => headers.map((_, index) => {
    const raw = row[index] ?? '';
    const amount = amounts[index] ? parseAmount(raw) : null;
    return amount !== null ? amount : raw;
  }));
  const ws = XLSX.utils.aoa_to_sheet([...lead, headers, ...table, ...(meta.bare ? [] : [[], [generatedLine()]])]);

  const width = Math.max(headers.length, 1);
  // Title lines span the table so long names are not cut off by a narrow first column.
  ws['!merges'] = titleRows.map((_, r) => ({ s: { r, c: 0 }, e: { r, c: width - 1 } }));
  const firstTableRow = lead.length + 1;
  for (let r = 0; r < table.length; r += 1) {
    for (let c = 0; c < headers.length; c += 1) {
      const cell = ws[XLSX.utils.encode_cell({ r: firstTableRow + r, c })] as XLSX.CellObject | undefined;
      if (cell && cell.t === 'n') cell.z = '#,##0.00';
    }
  }
  ws['!cols'] = headers.map((header, index) => {
    const longest = body.reduce((max, row) => Math.max(max, (row[index] ?? '').length), header.length);
    return { wch: Math.min(Math.max(longest + 2, 10), 60) };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, (meta.title ?? 'Report').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Report');
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

/**
 * PDF export: company, report name and period centred at the top of every
 * page; amounts right-aligned; section and total rows in bold; and a footer on
 * every page with when it was generated and "Page X of Y".
 */
export function downloadAsPdf(
  headers: string[], rows: string[][], title: string, filename: string, meta: ExportMeta = {},
): void {
  buildPdf(headers, rows, title, meta).save(`${filename}.pdf`);
}

/** The PDF document itself, before it is saved. Exposed for testing. */
export function buildPdf(headers: string[], rows: string[][], title: string, meta: ExportMeta = {}): jsPDF {
  const body = filledRows(rows);
  const amounts = amountColumns(headers, body);
  const company = getExportCompany();
  const doc = new jsPDF({ orientation: headers.length > 6 ? 'landscape' : 'portrait' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const totalPagesToken = '{total_pages}';
  const generated = generatedLine();

  const headerLines = [
    ...(company ? [{ text: company, size: 14, bold: true }] : []),
    { text: meta.title ?? title, size: 11, bold: true },
    ...(meta.subtitle ? [{ text: meta.subtitle, size: 9, bold: false }] : []),
  ];
  const headerHeight = 10 + headerLines.reduce((sum, line) => sum + line.size * 0.5 + 1, 0);

  autoTable(doc, {
    head: [headers],
    body: body.map(row => headers.map((_, index) => {
      const raw = row[index] ?? '';
      const amount = amounts[index] ? parseAmount(raw) : null;
      return amount !== null ? fmtExportAmount(amount) : raw;
    })),
    margin: { top: headerHeight + 4, bottom: 16, left: 12, right: 12 },
    styles: { fontSize: 8, cellPadding: 2.2, overflow: 'linebreak' },
    headStyles: { fillColor: [235, 235, 235], textColor: [0, 0, 0], fontStyle: 'bold' },
    columnStyles: Object.fromEntries(
      amounts.map((isAmount, index) => [index, { halign: isAmount ? 'right' as const : 'left' as const }]),
    ),
    didParseCell: data => {
      if (data.section === 'head') {
        if (amounts[data.column.index]) data.cell.styles.halign = 'right';
        return;
      }
      const kind = rowKind(body[data.row.index] ?? []);
      if (kind !== 'normal') data.cell.styles.fontStyle = 'bold';
      if (kind === 'section') data.cell.styles.fillColor = [245, 245, 245];
    },
    didDrawPage: data => {
      let y = 10;
      for (const line of headerLines) {
        doc.setFont('helvetica', line.bold ? 'bold' : 'normal');
        doc.setFontSize(line.size);
        doc.setTextColor(20);
        y += line.size * 0.5;
        doc.text(line.text, pageWidth / 2, y, { align: 'center' });
        y += 1;
      }
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(110);
      doc.text(generated, 12, pageHeight - 8);
      doc.text(`Page ${data.pageNumber} of ${totalPagesToken}`, pageWidth - 12, pageHeight - 8, { align: 'right' });
    },
  });
  doc.putTotalPages(totalPagesToken);
  return doc;
}

export type DepositSlipLine = {
  received_from: string;
  description: string;
  payment_method: string;
  ref_no: string;
  amount: string;
};

export type DepositDocInput = {
  depositNumber: string;
  depositDate: string;
  bankAccountName: string;
  bankAccountLastFour: string | null;
  lines: DepositSlipLine[];
  linesTotal: string;
  cashBackAccountName: string | null;
  cashBackMemo: string | null;
  cashBackAmount: string | null;
  netTotal: string;
  businessName: string;
  businessAddressLines: string[];
};

// jspdf-autotable attaches finalY to the doc instance at runtime; there is no
// public type export for it, so this narrow helper is the one place that
// reaches past the types instead of sprinkling `as any` through the layout code.
function lastAutoTableFinalY(doc: jsPDF): number {
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
}

function categorizePaymentMethod(method: string): 'cash' | 'check' | 'electronic' | 'other' {
  const v = method.toLowerCase();
  if (v.includes('cash')) return 'cash';
  if (v.includes('check') || v.includes('cheque')) return 'check';
  if (v.includes('ach') || v.includes('wire') || v.includes('eft') || v.includes('electronic') || v.includes('transfer')) return 'electronic';
  return 'other';
}

// Caller pre-formats money/dates (fmtMoney/fmtShortDate etc.) — this stays a
// pure layout concern, matching downloadAsPdf/downloadAsExcel above, which
// also take already-formatted strings rather than raw values.
function drawDepositSummaryPage(doc: jsPDF, input: DepositDocInput): void {
  const marginX = 14;
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 18;

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('Deposit Summary', marginX, y);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(input.depositNumber, pageWidth - marginX, y, { align: 'right' });
  y += 8;

  doc.setFontSize(10);
  doc.setTextColor(90);
  doc.text(`Deposits to ${input.bankAccountName} on ${input.depositDate}`, marginX, y);
  doc.setTextColor(0);
  y += 6;

  doc.setDrawColor(200);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 8;

  autoTable(doc, {
    head: [['Check No.', 'Payment Method', 'Received From', 'Memo', 'Amount']],
    body: input.lines.map(l => [l.ref_no, l.payment_method, l.received_from, l.description, l.amount]),
    startY: y,
    margin: { left: marginX, right: marginX },
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [235, 235, 235], textColor: [0, 0, 0], fontStyle: 'bold' },
    columnStyles: { 4: { halign: 'right' } },
  });
  y = lastAutoTableFinalY(doc) + 8;

  const totalsX = pageWidth - marginX - 56;
  doc.setFontSize(10);
  doc.text('Deposit Subtotal', totalsX, y);
  doc.text(input.linesTotal, pageWidth - marginX, y, { align: 'right' });
  y += 6;

  if (input.cashBackAmount) {
    const label = input.cashBackAccountName
      ? `Less Cash Back — ${input.cashBackAccountName}`
      : 'Less Cash Back';
    doc.text(input.cashBackMemo ? `${label} (${input.cashBackMemo})` : label, totalsX, y);
    doc.text(`(${input.cashBackAmount})`, pageWidth - marginX, y, { align: 'right' });
    y += 6;
  }

  doc.setDrawColor(200);
  doc.line(totalsX, y, pageWidth - marginX, y);
  y += 6;
  doc.setFont('helvetica', 'bold');
  doc.text('Deposit Total', totalsX, y);
  doc.text(input.netTotal, pageWidth - marginX, y, { align: 'right' });
  doc.setFont('helvetica', 'normal');

  const pageHeight = doc.internal.pageSize.getHeight();
  let footerY = pageHeight - 10 - (input.businessAddressLines.length * 4);
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(input.businessName, marginX, footerY);
  for (const line of input.businessAddressLines) {
    footerY += 4;
    doc.text(line, marginX, footerY);
  }
  doc.setTextColor(0);
}

// The physical paper-slip layout: items grouped by how they'll actually be
// handed to the teller (cash counted together, checks listed by number,
// electronic items separately) rather than by how they got into the deposit.
function drawBankSlipPage(doc: jsPDF, input: DepositDocInput): void {
  const marginX = 14;
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 18;

  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(input.businessName, marginX, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  for (const line of input.businessAddressLines) {
    y += 4.5;
    doc.text(line, marginX, y);
  }
  y += 10;

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Bank Deposit Slip', marginX, y);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(input.depositNumber, pageWidth - marginX, y, { align: 'right' });
  y += 8;

  doc.setDrawColor(200);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 7;

  const accountLabel = input.bankAccountLastFour
    ? `${input.bankAccountName} (...${input.bankAccountLastFour})`
    : input.bankAccountName;
  doc.setFontSize(10);
  doc.text(`Account: ${accountLabel}`, marginX, y);
  doc.text(`Date: ${input.depositDate}`, pageWidth - marginX, y, { align: 'right' });
  y += 10;

  const cash = input.lines.filter(l => categorizePaymentMethod(l.payment_method) === 'cash');
  const checks = input.lines.filter(l => categorizePaymentMethod(l.payment_method) === 'check');
  const electronic = input.lines.filter(l => categorizePaymentMethod(l.payment_method) === 'electronic');
  const other = input.lines.filter(l => categorizePaymentMethod(l.payment_method) === 'other');

  const colGap = 6;
  const colWidth = (pageWidth - marginX * 2 - colGap) / 2;
  const rightX = marginX + colWidth + colGap;

  autoTable(doc, {
    head: [['Cash', 'Amount']],
    body: cash.length > 0 ? cash.map(l => [l.description || 'Cash', l.amount]) : [['—', '—']],
    startY: y,
    margin: { left: marginX },
    tableWidth: colWidth,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [235, 235, 235], textColor: [0, 0, 0], fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right' } },
  });
  const cashFinalY = lastAutoTableFinalY(doc);

  autoTable(doc, {
    head: [['Check No.', 'Amount']],
    body: checks.length > 0 ? checks.map(l => [l.ref_no || '—', l.amount]) : [['—', '—']],
    startY: y,
    margin: { left: rightX },
    tableWidth: colWidth,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [235, 235, 235], textColor: [0, 0, 0], fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right' } },
  });
  y = Math.max(cashFinalY, lastAutoTableFinalY(doc)) + 8;

  if (electronic.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Electronic (ACH / Wire / EFT)', marginX, y);
    doc.setFont('helvetica', 'normal');
    y += 2;
    autoTable(doc, {
      head: [['Description', 'Ref No.', 'Amount']],
      body: electronic.map(l => [l.description || '—', l.ref_no || '—', l.amount]),
      startY: y,
      margin: { left: marginX, right: marginX },
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [235, 235, 235], textColor: [0, 0, 0], fontStyle: 'bold' },
      columnStyles: { 2: { halign: 'right' } },
    });
    y = lastAutoTableFinalY(doc) + 8;
  }

  if (other.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Other', marginX, y);
    doc.setFont('helvetica', 'normal');
    y += 2;
    autoTable(doc, {
      head: [['Description', 'Ref No.', 'Amount']],
      body: other.map(l => [l.description || '—', l.ref_no || '—', l.amount]),
      startY: y,
      margin: { left: marginX, right: marginX },
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [235, 235, 235], textColor: [0, 0, 0], fontStyle: 'bold' },
      columnStyles: { 2: { halign: 'right' } },
    });
    y = lastAutoTableFinalY(doc) + 8;
  }

  const totalsX = pageWidth - marginX - 60;
  doc.setFontSize(10);
  doc.text('Subtotal', totalsX, y);
  doc.text(input.linesTotal, pageWidth - marginX, y, { align: 'right' });
  y += 6;

  if (input.cashBackAmount) {
    doc.text('Less Cash Back', totalsX, y);
    doc.text(`(${input.cashBackAmount})`, pageWidth - marginX, y, { align: 'right' });
    y += 6;
  }

  doc.setDrawColor(200);
  doc.line(totalsX, y, pageWidth - marginX, y);
  y += 6;
  doc.setFont('helvetica', 'bold');
  doc.text('Net Deposit Total', totalsX, y);
  doc.text(input.netTotal, pageWidth - marginX, y, { align: 'right' });
  doc.setFont('helvetica', 'normal');
}

// Opens the PDF in the browser's own viewer (zoom, page nav, and its own
// Download/Print buttons) instead of forcing an immediate file save — matches
// what QuickBooks' print dialog does. `target`, when given, must be a window
// already opened synchronously inside the click handler (e.g.
// `window.open('', '_blank')` called before any `await`): opening a window
// only after an async PDF-build step runs is what popup blockers — Safari's
// especially — treat as not user-initiated and silently kill.
function openPdfPreview(doc: jsPDF, target?: Window | null): void {
  const url = doc.output('bloburl').toString();
  if (target) target.location.href = url;
  else window.open(url, '_blank');
}

/** "Print deposit summary only" — page 2 content as a standalone single-page PDF, opened for preview. */
export function previewDepositSummary(input: DepositDocInput, target?: Window | null): void {
  const doc = new jsPDF({ orientation: 'portrait', format: 'letter' });
  doc.setProperties({ title: `${input.depositNumber}-summary.pdf` });
  drawDepositSummaryPage(doc, input);
  openPdfPreview(doc, target);
}

/** "Print deposit slip and summary" — the physical slip, then the summary, as one 2-page PDF, opened for preview. */
export function previewDepositSlipAndSummary(input: DepositDocInput, target?: Window | null): void {
  const doc = new jsPDF({ orientation: 'portrait', format: 'letter' });
  doc.setProperties({ title: `${input.depositNumber}.pdf` });
  drawBankSlipPage(doc, input);
  doc.addPage();
  drawDepositSummaryPage(doc, input);
  openPdfPreview(doc, target);
}

/** "Setup and alignment" — a printer-calibration page for pre-printed deposit slip forms, opened for preview. No deposit data involved on purpose. */
export function previewDepositAlignmentTest(target?: Window | null): void {
  const doc = new jsPDF({ orientation: 'portrait', format: 'letter' });
  doc.setProperties({ title: 'deposit-slip-alignment-test.pdf' });
  const marginX = 14;
  const marginY = 14;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  doc.setDrawColor(0);
  doc.setLineWidth(0.5);
  doc.rect(marginX, marginY, pageWidth - marginX * 2, pageHeight - marginY * 2);

  const corners: Array<[number, number]> = [
    [marginX, marginY], [pageWidth - marginX, marginY],
    [marginX, pageHeight - marginY], [pageWidth - marginX, pageHeight - marginY],
  ];
  for (const [cx, cy] of corners) {
    doc.line(cx - 4, cy, cx + 4, cy);
    doc.line(cx, cy - 4, cx, cy + 4);
  }

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Deposit Slip Alignment Test', marginX + 6, marginY + 10);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);

  let y = marginY + 22;
  const fields = [
    'BUSINESS NAME HERE', 'ADDRESS LINE HERE', 'ACCOUNT NAME HERE', 'DATE HERE',
    'CASH TOTAL HERE', 'CHECK 1 HERE', 'CHECK 2 HERE', 'ELECTRONIC ITEM HERE',
    'SUBTOTAL HERE', 'CASH BACK HERE', 'NET TOTAL HERE',
  ];
  for (const field of fields) {
    doc.text(field, marginX + 6, y);
    doc.setDrawColor(180);
    doc.line(marginX + 6, y + 1.5, pageWidth - marginX - 6, y + 1.5);
    y += 14;
  }

  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(
    'Use this page to verify alignment with pre-printed deposit slip forms. Adjust printer margins if text does not align with form fields.',
    marginX + 6, pageHeight - marginY - 6, { maxWidth: pageWidth - marginX * 2 - 12 },
  );
  doc.setTextColor(0);

  openPdfPreview(doc, target);
}

// ── Write Check printing ────────────────────────────────────────────────────

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function threeDigitsToWords(n: number): string {
  const parts: string[] = [];
  if (n >= 100) { parts.push(`${ONES[Math.floor(n / 100)]} hundred`); n %= 100; }
  if (n >= 20) { parts.push(TENS[Math.floor(n / 10)]!); n %= 10; }
  if (n > 0) parts.push(ONES[n]!);
  return parts.join(' ');
}

/** "Six hundred ninety and 20/100" — the check-writing convention of whole
 * dollars spelled out, cents as a fraction. Caps at the highest scale a
 * check would realistically need; anything larger just reads oddly, not
 * incorrectly. */
export function amountInWords(amount: string | number): string {
  const value = Math.abs(Number(amount));
  const dollars = Math.floor(value);
  const cents = Math.round((value - dollars) * 100);
  const scales: Array<[number, string]> = [[1_000_000_000, 'billion'], [1_000_000, 'million'], [1_000, 'thousand']];
  let remaining = dollars;
  const parts: string[] = [];
  for (const [scale, name] of scales) {
    if (remaining >= scale) {
      parts.push(`${threeDigitsToWords(Math.floor(remaining / scale))} ${name}`);
      remaining %= scale;
    }
  }
  if (remaining > 0 || parts.length === 0) parts.push(threeDigitsToWords(remaining));
  const words = parts.join(' ').trim() || 'zero';
  const capitalized = words.charAt(0).toUpperCase() + words.slice(1);
  return `${capitalized} and ${String(cents).padStart(2, '0')}/100`;
}

export type CheckDocInput = {
  checkNumber: string;
  paymentDate: string;
  payeeName: string;
  mailingAddress: string[];
  amount: string;
  bankAccountName: string;
  bankAccountLastFour: string | null;
  memo: string | null;
  lines: Array<{ accountLabel: string; description: string; amount: string }>;
  businessName: string;
};

// Caller pre-formats money (fmtMoney) — this stays a pure layout concern,
// same convention as the deposit slip/summary above. A plain single-check
// layout for now (not the 3-per-page QuickBooks voucher stock); the stub
// content below the check line is the "voucher" QBO prints for the payee's
// and the business's own records.
function drawCheckPage(doc: jsPDF, input: CheckDocInput): void {
  const marginX = 14;
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 16;

  // ── Check portion ──
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(input.businessName, marginX, y);
  doc.setFont('helvetica', 'normal');
  const accountLabel = input.bankAccountLastFour
    ? `${input.bankAccountName} (...${input.bankAccountLastFour})`
    : input.bankAccountName;
  doc.setFontSize(9);
  doc.text(accountLabel, marginX, y + 5);

  doc.setFontSize(10);
  doc.text(`Date: ${input.paymentDate}`, pageWidth - marginX, y, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.text(`No. ${input.checkNumber}`, pageWidth - marginX, y + 5, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  y += 16;

  doc.setFontSize(10);
  doc.text('Pay to the order of:', marginX, y);
  doc.setFont('helvetica', 'bold');
  doc.text(input.payeeName, marginX + 36, y);
  doc.setFont('helvetica', 'normal');
  doc.text(`$ ${input.amount}`, pageWidth - marginX, y, { align: 'right' });
  y += 7;

  doc.setFontSize(9);
  doc.text(amountInWords(input.amount.replace(/,/g, '')), marginX, y);
  doc.setDrawColor(0);
  doc.line(marginX, y + 1.5, pageWidth - marginX, y + 1.5);
  y += 10;

  doc.setFontSize(9);
  for (const line of input.mailingAddress) {
    doc.text(line, marginX, y);
    y += 4.5;
  }
  y += 8;

  if (input.memo) {
    doc.setFontSize(8);
    doc.setTextColor(90);
    doc.text(`Memo: ${input.memo}`, marginX, y);
    doc.setTextColor(0);
    y += 6;
  }

  doc.setDrawColor(150);
  doc.setLineDashPattern([2, 1], 0);
  doc.line(marginX, y, pageWidth - marginX, y);
  doc.setLineDashPattern([], 0);
  y += 10;

  // ── Voucher stub: the line-item detail, for the payer's or payee's records ──
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(`Check ${input.checkNumber}`, marginX, y);
  doc.setFont('helvetica', 'normal');
  doc.text(input.paymentDate, pageWidth - marginX, y, { align: 'right' });
  y += 6;

  autoTable(doc, {
    head: [['Category', 'Description', 'Amount']],
    body: input.lines.map(l => [l.accountLabel, l.description, l.amount]),
    startY: y,
    margin: { left: marginX, right: marginX },
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [235, 235, 235], textColor: [0, 0, 0], fontStyle: 'bold' },
    columnStyles: { 2: { halign: 'right' } },
  });
  y = lastAutoTableFinalY(doc) + 6;

  doc.setFont('helvetica', 'bold');
  doc.text('Total', pageWidth - marginX - 40, y);
  doc.text(input.amount, pageWidth - marginX, y, { align: 'right' });
  doc.setFont('helvetica', 'normal');
}

/** "Print check" — opened for preview, same pattern as the deposit slip/summary. */
export function previewCheck(input: CheckDocInput, target?: Window | null): void {
  const doc = new jsPDF({ orientation: 'portrait', format: 'letter' });
  doc.setProperties({ title: `Check-${input.checkNumber}.pdf` });
  drawCheckPage(doc, input);
  openPdfPreview(doc, target);
}
