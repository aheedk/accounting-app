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
  XLSX.utils.book_append_sheet(wb, ws, (meta.title ?? 'Report').replace(/[\/?*[\]:]/g, ' ').slice(0, 31) || 'Report');
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
