import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { fmtMoney } from './money';
import { fmtQty } from './labels';

// An invoice as a document to send: who it is from, who it is to, the lines, and
// what is owed. Built in the browser, like the deposit slip and the check.

export type InvoicePdfInput = {
  companyName: string;
  companyAddressLines: string[];
  customerName: string;
  invoiceNumber: string;
  /** Already formatted for reading ("October 7, 2026"). */
  issueDate: string;
  dueDate: string;
  terms: string | null;
  status: string;
  lines: Array<{ description: string; quantity: string; unitPrice: string; amount: string }>;
  subtotal: string;
  taxTotal: string;
  total: string;
  /** Payments and credits applied so far. */
  paid: string;
  balanceDue: string;
  memo: string | null;
};

/** The rows of the totals block, top to bottom. Tax and payments only appear when there are any. */
export function invoiceTotalsRows(input: Pick<InvoicePdfInput, 'subtotal' | 'taxTotal' | 'total' | 'paid' | 'balanceDue'>): Array<[string, string]> {
  const rows: Array<[string, string]> = [['Subtotal', fmtMoney(input.subtotal)]];
  if (Number(input.taxTotal) !== 0) rows.push(['Tax', fmtMoney(input.taxTotal)]);
  rows.push(['Total', fmtMoney(input.total)]);
  if (Number(input.paid) !== 0) rows.push(['Payments and credits', `-${fmtMoney(input.paid)}`]);
  rows.push(['Balance due', fmtMoney(input.balanceDue)]);
  return rows;
}

export function buildInvoicePdf(input: InvoicePdfInput): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', format: 'letter', unit: 'pt' });
  doc.setProperties({ title: `Invoice-${input.invoiceNumber}.pdf` });
  const pageWidth = doc.internal.pageSize.getWidth();
  const left = 48;
  const right = pageWidth - 48;

  // From.
  doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(20);
  doc.text(input.companyName || 'Invoice', left, 60);
  doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(90);
  input.companyAddressLines.forEach((line, i) => doc.text(line, left, 76 + i * 12));

  // What this is.
  doc.setFont('helvetica', 'bold').setFontSize(22).setTextColor(20);
  doc.text('INVOICE', right, 62, { align: 'right' });
  if (input.status === 'voided') {
    doc.setFontSize(11).setTextColor(190, 0, 0);
    doc.text('VOIDED', right, 78, { align: 'right' });
  }

  // To, and the particulars.
  const blockTop = 136;
  doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(110);
  doc.text('BILL TO', left, blockTop);
  doc.setFont('helvetica', 'normal').setFontSize(11).setTextColor(20);
  doc.text(input.customerName, left, blockTop + 16);

  const particulars: Array<[string, string]> = [
    ['Invoice no.', input.invoiceNumber],
    ['Date', input.issueDate],
    ['Due', input.dueDate],
    ...(input.terms ? [['Terms', input.terms] as [string, string]] : []),
  ];
  particulars.forEach(([label, value], i) => {
    const y = blockTop + i * 15;
    doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(110);
    doc.text(label, right - 170, y);
    doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(20);
    doc.text(value, right, y, { align: 'right' });
  });

  autoTable(doc, {
    startY: blockTop + 72,
    margin: { left, right: 48 },
    head: [['Description', 'Qty', 'Rate', 'Amount']],
    body: input.lines.map(line => [line.description, fmtQty(line.quantity), fmtMoney(line.unitPrice), fmtMoney(line.amount)]),
    styles: { fontSize: 9.5, cellPadding: 6, overflow: 'linebreak' },
    headStyles: { fillColor: [240, 240, 240], textColor: [40, 40, 40], fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right', cellWidth: 50 }, 2: { halign: 'right', cellWidth: 80 }, 3: { halign: 'right', cellWidth: 90 } },
    didParseCell: data => { if (data.section === 'head' && data.column.index > 0) data.cell.styles.halign = 'right'; },
  });

  // Totals, under the table on the right.
  const tableEnd = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? blockTop + 120;
  let y = tableEnd + 24;
  const rows = invoiceTotalsRows(input);
  rows.forEach(([label, value], i) => {
    const last = i === rows.length - 1;
    doc.setFont('helvetica', last ? 'bold' : 'normal').setFontSize(last ? 12 : 10).setTextColor(20);
    if (last) {
      // A rule and a little air above the figure that matters.
      y += 8;
      doc.setDrawColor(180).line(right - 220, y - 15, right, y - 15);
    }
    doc.text(label, right - 220, y);
    doc.text(value, right, y, { align: 'right' });
    y += last ? 20 : 16;
  });

  if (input.memo) {
    doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(90);
    doc.text(doc.splitTextToSize(input.memo, right - left - 240) as string[], left, tableEnd + 24);
  }
  return doc;
}

/** Saves the invoice as a PDF file. */
export function downloadInvoicePdf(input: InvoicePdfInput): void {
  buildInvoicePdf(input).save(`Invoice-${input.invoiceNumber}.pdf`);
}
