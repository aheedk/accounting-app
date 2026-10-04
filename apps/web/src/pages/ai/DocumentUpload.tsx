import { useRef, useState } from 'react';
import { Upload, Loader2 } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';

type Props = {
  /** Called after a successful upload so the inbox can refresh. */
  onUploaded: () => void | Promise<void>;
};

type UploadState = { busy: boolean; error: string | null; done: string | null };

type UploadResult =
  | { kind: 'bank_statement' | 'credit_card_statement'; staging_id: string; statement_count: number }
  | { kind: 'invoice'; staging_id: string }
  | { kind: 'check_stubs'; check_count: number };

const ACCEPTED = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

/** What the AI recognised, for the confirmation line. */
function describeResult(result: UploadResult): string {
  switch (result.kind) {
    case 'bank_statement':
      return result.statement_count > 1 ? `${result.statement_count} bank statements (one per account)` : 'bank statement';
    case 'credit_card_statement': return 'credit card statement';
    case 'invoice': return 'invoice';
    case 'check_stubs': return `${result.check_count} check stub${result.check_count === 1 ? '' : 's'} (see the Check stubs tab)`;
  }
}

/**
 * Direct PDF upload, so a statement or bill does not have to be emailed in.
 * Runs the same extraction path as the email route and lands in the same
 * review queue.
 */
export default function DocumentUpload({ onUploaded }: Props) {
  const [bizId] = useActiveBusinessId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [state, setState] = useState<UploadState>({ busy: false, error: null, done: null });

  async function send(files: FileList | null) {
    if (!bizId || !files || files.length === 0) return;
    // PDFs, plus images for photographed check stubs.
    const pdfs = Array.from(files).filter(file => ACCEPTED.includes(file.type));
    if (pdfs.length === 0) {
      setState({ busy: false, error: 'Upload a PDF or an image (PNG, JPEG, WebP).', done: null });
      return;
    }

    setState({ busy: true, error: null, done: null });
    let uploaded = 0;
    const kinds: string[] = [];
    try {
      for (const file of pdfs) {
        const body = new FormData();
        body.append('file', file);
        // Sequential on purpose: each upload runs a model call server-side, and
        // firing a whole folder at once would stack them.
        // eslint-disable-next-line no-await-in-loop
        const res = await api.post<UploadResult>(`/businesses/${bizId}/ai/documents`, body);
        kinds.push(describeResult(res.data));
        uploaded += 1;
      }
      setState({
        busy: false,
        error: null,
        done: `${uploaded} document${uploaded === 1 ? '' : 's'} processed: ${kinds.join(', ')}.`,
      });
      await onUploaded();
    } catch (error: unknown) {
      const message = error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { data?: { error?: { message?: string } } } })
          .response?.data?.error?.message
        : undefined;
      setState({
        busy: false,
        error: message ?? 'Upload failed. Please try again.',
        done: uploaded > 0 ? `${uploaded} processed before the error.` : null,
      });
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="space-y-2">
      <div
        onDragOver={event => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={event => {
          event.preventDefault();
          setDragging(false);
          void send(event.dataTransfer.files);
        }}
        className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
          dragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 bg-muted/10'
        }`}
      >
        {state.busy ? (
          <>
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm font-medium">Reading the document…</p>
            <p className="text-xs text-muted-foreground">
              Extracting transactions and suggesting accounts.
            </p>
          </>
        ) : (
          <>
            <Upload className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm font-medium">Drop a PDF here, or</p>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="text-sm font-medium text-primary hover:underline"
            >
              choose a file
            </button>
            <p className="text-xs text-muted-foreground">
              Bank statements and invoices. No need to email them in.
            </p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/png,image/jpeg,image/webp"
          multiple
          className="hidden"
          onChange={event => void send(event.target.files)}
        />
      </div>

      {state.error && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}
      {state.done && !state.error && (
        <p className="text-sm text-emerald-700">{state.done}</p>
      )}
    </div>
  );
}
