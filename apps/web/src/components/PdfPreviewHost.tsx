import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { setPdfPreviewListener } from '@/lib/download';

/**
 * Shows a print preview inside the app, the way QuickBooks does, instead of
 * in a new browser tab. The browser's own PDF viewer in the frame carries the
 * Print and Download buttons.
 */
export function PdfPreviewHost() {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    setPdfPreviewListener(setUrl);
    return () => setPdfPreviewListener(null);
  }, []);

  function close() {
    if (url) URL.revokeObjectURL(url);
    setUrl(null);
  }

  return (
    <Dialog open={url !== null} onOpenChange={open => { if (!open) close(); }}>
      <DialogContent className="flex h-[90vh] max-w-5xl flex-col">
        <DialogHeader><DialogTitle>Print preview</DialogTitle></DialogHeader>
        {url && <iframe title="Print preview" src={url} className="min-h-0 w-full flex-1 rounded-b-lg border-0" />}
      </DialogContent>
    </Dialog>
  );
}
