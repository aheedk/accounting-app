import { useEffect, useRef, useState } from 'react';
import { Paperclip, X } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { pickErr } from '@/lib/apiErrors';
import { useActiveBusinessId } from '@/lib/business';
import { cn } from '@/lib/utils';

// Must match the upload limit in apps/api/src/routes/files.ts.
const MAX_BYTES = 10 * 1024 * 1024;

export type AttachmentEntityType = 'expense_transaction' | 'journal_entry' | 'check' | 'bank_deposit';

type Attachment = {
  key: string;
  name: string;
  size: number;
  /** Set once the file is stored and linked to the document. */
  saved: { receiptId: string; fileId: string } | null;
  /** Held in the browser until the document exists. */
  pending: File | null;
};

type ReceiptRow = {
  id: string;
  file_id: string;
  file_name: string;
  file_byte_size: string | number;
};

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Files attached to a document. They are stored through the same files +
 * receipts tables the Receipts page uses, so an attachment also shows up there
 * as a receipt linked to this document.
 *
 * With an `entityId` each file is uploaded and linked as soon as it is added.
 * Without one (a form for a document that does not exist yet) files wait in the
 * browser; call `attachTo(id)` once the document has been created.
 */
export function useAttachments(entityType: AttachmentEntityType, entityId: string | null) {
  const [bizId] = useActiveBusinessId();
  const [items, setItems] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bizId || !entityId) return;
    let cancelled = false;
    api.get<{ receipts: ReceiptRow[] }>(`/businesses/${bizId}/receipts`, {
      params: { entity_type: entityType, entity_id: entityId },
    }).then(r => {
      if (cancelled) return;
      setItems(r.data.receipts.map(row => ({
        key: row.id,
        name: row.file_name,
        size: Number(row.file_byte_size),
        saved: { receiptId: row.id, fileId: row.file_id },
        pending: null,
      })));
    }).catch((e: unknown) => { if (!cancelled) setError(pickErr(e)); });
    return () => { cancelled = true; };
  }, [bizId, entityType, entityId]);

  async function uploadAndLink(file: File, targetId: string): Promise<Attachment> {
    const body = new FormData();
    body.append('file', file);
    // Axios sets the multipart Content-Type (with boundary) itself for FormData.
    const stored = await api.post<{ id: string }>(`/businesses/${bizId}/files`, body);
    const receipt = await api.post<{ id: string }>(`/businesses/${bizId}/receipts`, {
      file_id: stored.data.id,
      linked_entity_type: entityType,
      linked_entity_id: targetId,
    });
    return {
      key: receipt.data.id,
      name: file.name,
      size: file.size,
      saved: { receiptId: receipt.data.id, fileId: stored.data.id },
      pending: null,
    };
  }

  async function add(files: File[]) {
    if (!bizId || files.length === 0) return;
    setError(null);
    const tooBig = files.filter(file => file.size > MAX_BYTES);
    const usable = files.filter(file => file.size <= MAX_BYTES && file.size > 0);
    if (tooBig.length > 0) setError(`${tooBig.map(file => file.name).join(', ')} is over the 10 MB limit.`);

    if (!entityId) {
      setItems(prev => [...prev, ...usable.map(file => ({
        key: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`,
        name: file.name,
        size: file.size,
        saved: null,
        pending: file,
      }))]);
      return;
    }
    setBusy(true);
    try {
      for (const file of usable) {
        const attached = await uploadAndLink(file, entityId);
        setItems(prev => [...prev, attached]);
      }
    } catch (e: unknown) {
      setError(pickErr(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: Attachment) {
    setError(null);
    if (item.saved && bizId) {
      try {
        // There is no delete: the file stays on the Receipts page as an unlinked receipt.
        await api.patch(`/businesses/${bizId}/receipts/${item.saved.receiptId}/link`, {
          linked_entity_type: 'unlinked',
          linked_entity_id: null,
        });
      } catch (e: unknown) {
        setError(pickErr(e));
        return;
      }
    }
    setItems(prev => prev.filter(other => other.key !== item.key));
  }

  /**
   * Upload and link the files added before the document existed. Never throws:
   * the document is already saved, so the caller should carry on and show the
   * returned message (null when everything attached).
   */
  async function attachTo(newEntityId: string): Promise<string | null> {
    const waiting = items.filter(item => item.pending !== null);
    if (!bizId || waiting.length === 0) return null;
    const failed: string[] = [];
    for (const item of waiting) {
      try {
        await uploadAndLink(item.pending as File, newEntityId);
      } catch {
        failed.push(item.name);
      }
    }
    return failed.length > 0
      ? `Saved, but these files could not be attached: ${failed.join(', ')}. Add them again from this page.`
      : null;
  }

  async function download(item: Attachment) {
    if (item.pending) {
      window.open(URL.createObjectURL(item.pending), '_blank', 'noopener');
      return;
    }
    if (!item.saved || !bizId) return;
    try {
      const r = await api.get(`/businesses/${bizId}/files/${item.saved.fileId}/download`, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data as Blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = item.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      // Revoke after a tick so the browser can finish the download.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e: unknown) {
      setError(pickErr(e));
    }
  }

  return { items, busy, error, add, remove, attachTo, download, reset: () => setItems([]) };
}

export function AttachmentsPanel({
  attachments, className,
}: { attachments: ReturnType<typeof useAttachments>; className?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div className={className}>
      <label className="mb-2 block text-sm font-medium">Attachments</label>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => {
          e.preventDefault();
          setDragging(false);
          void attachments.add([...e.dataTransfer.files]);
        }}
        className={cn(
          'flex h-[108px] w-full flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed text-sm text-muted-foreground transition-colors',
          'hover:border-primary/40 hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          dragging && 'border-primary/60 bg-muted/30',
        )}
      >
        <Paperclip className="h-5 w-5" />
        <span>{attachments.busy ? 'Uploading…' : 'Add attachment'}</span>
        <span className="text-xs">Click or drop files here · Max file size: 10 MB</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={e => {
          void attachments.add([...(e.target.files ?? [])]);
          // Clear it so picking the same file again still fires onChange.
          e.target.value = '';
        }}
      />
      {attachments.error && <p className="mt-2 text-sm text-destructive">{attachments.error}</p>}
      {attachments.items.length > 0 && (
        <ul className="mt-2 divide-y rounded-md border text-sm">
          {attachments.items.map(item => (
            <li key={item.key} className="flex items-center gap-2 px-3 py-2">
              <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-primary hover:underline"
                onClick={() => { void attachments.download(item); }}
                title={item.name}
              >
                {item.name}
              </button>
              <span className="shrink-0 text-xs text-muted-foreground">{fmtSize(item.size)}</span>
              <button
                type="button"
                aria-label={`Remove ${item.name}`}
                className="shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => { void attachments.remove(item); }}
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
