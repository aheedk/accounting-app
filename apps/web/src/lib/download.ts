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
