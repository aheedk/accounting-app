import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import DocumentUpload from '@/pages/ai/DocumentUpload';

// A client's way to hand documents to the firm without emailing them: bank and
// card statements, bills, receipts, check stubs. They go to the firm's inbox,
// the same one emailed documents reach, and nothing touches the books until an
// accountant has looked at it.
export default function SendDocumentsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Send documents</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Bank and credit card statements, bills, receipts and check stubs. PDFs, or photos for stubs and receipts.
        </p>
      </div>
      <Card>
        <CardHeader><CardTitle>Upload</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <DocumentUpload onUploaded={() => undefined} />
          <p className="text-sm text-muted-foreground">
            Each one is read as it arrives, which can take a minute for a long statement. Your accountant
            reviews it before anything is recorded in your books. Have a question about one?{' '}
            <Link className="text-primary hover:underline" to="/messages">Send a message.</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
