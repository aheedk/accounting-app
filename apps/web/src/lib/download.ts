import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export function downloadAsExcel(headers: string[], rows: string[][], filename: string): void {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows.filter(r => r.some(c => c.trim()))]);
  // Force all numeric cells to 2dp with comma grouping (#,##0.00).
  // Without this, XLSX infers the format from the raw string (e.g. "2000.0000" → #,##0.0000).
  const ref = ws['!ref'];
  if (ref) {
    const range = XLSX.utils.decode_range(ref);
    for (let R = range.s.r; R <= range.e.r; ++R) {
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
        if (cell && cell.t === 'n') cell.z = '#,##0.00';
      }
    }
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

export function downloadAsPdf(headers: string[], rows: string[][], title: string, filename: string): void {
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(13);
  doc.text(title, 14, 14);
  autoTable(doc, {
    head: [headers],
    body: rows.filter(r => r.some(c => c.trim())),
    startY: 20,
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [230, 230, 230], textColor: [0, 0, 0], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [250, 250, 250] },
  });
  doc.save(`${filename}.pdf`);
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
