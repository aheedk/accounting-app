import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { downloadAsExcel, downloadAsPdf } from '@/lib/download';

interface Props {
  headers: string[];
  getRows: () => string[][];
  filename: string;
  title: string;
}

export function DownloadButtons({ headers, getRows, filename, title }: Props) {
  const [excelBusy, setExcelBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  function handleExcel() {
    setExcelBusy(true);
    try { downloadAsExcel(headers, getRows(), filename); } finally { setExcelBusy(false); }
  }
  function handlePdf() {
    setPdfBusy(true);
    try { downloadAsPdf(headers, getRows(), title, filename); } finally { setPdfBusy(false); }
  }

  return (
    <div className="flex gap-2">
      <Button variant="outline" size="sm" disabled={excelBusy} onClick={handleExcel}>
        {excelBusy ? 'Downloading…' : 'Download Excel'}
      </Button>
      <Button variant="outline" size="sm" disabled={pdfBusy} onClick={handlePdf}>
        {pdfBusy ? 'Downloading…' : 'Download PDF'}
      </Button>
    </div>
  );
}
