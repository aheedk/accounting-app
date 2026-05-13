import { useCallback, useEffect, useRef, useState } from 'react';
import { DateInput } from '@/components/ui/date-input';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type ItemKey =
  | 'state_registration'
  | 'new_hire_report'
  | 'labor_law_poster'
  | 'annual_filing';

type ItemStatus = 'open' | 'in_progress' | 'done' | 'na';

type ComplianceItem = {
  id: string;
  business_id: string;
  item_key: ItemKey;
  status: ItemStatus;
  due_date: string | null;
  notes: string | null;
  document_file_id: string | null;
  created_at: string;
  updated_at: string;
};

type FileRow = {
  id: string;
  original_name: string;
  mime_type: string;
  byte_size: number;
  storage_path: string;
};

const ITEM_LABELS: Record<ItemKey, string> = {
  state_registration: 'State registration',
  new_hire_report: 'New hire report',
  labor_law_poster: 'Labor law poster',
  annual_filing: 'Annual filing',
};

const STATUS_LABELS: Record<ItemStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  done: 'Done',
  na: 'N/A',
};

function pickErr(e: unknown): string {
  const resp = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)
    ?.response?.data?.error?.message;
  if (resp) return resp;
  if (e instanceof Error) return e.message;
  return 'Request failed';
}

export default function CompliancePage() {
  const [bizId] = useActiveBusinessId();
  const [items, setItems] = useState<ComplianceItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Per-item busy flag so we can disable controls during inflight requests without
  // freezing the entire list.
  const [busyId, setBusyId] = useState<string | null>(null);
  // Cache uploaded file metadata so the "View document" link can render the original
  // filename instead of just a UUID.
  const [files, setFiles] = useState<Record<string, FileRow>>({});
  // Track per-row file inputs so we can clear them after upload completes.
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const reload = useCallback(async () => {
    if (!bizId) {
      setItems([]);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const r = await api.get<{ items: ComplianceItem[] }>(
        `/businesses/${bizId}/compliance-items`,
      );
      setItems(r.data.items);
      // Hydrate filename metadata for any documents we haven't seen yet.
      const known = new Set(Object.keys(files));
      const missing = r.data.items
        .map((i) => i.document_file_id)
        .filter((id): id is string => !!id && !known.has(id));
      if (missing.length > 0) {
        const fetched: Record<string, FileRow> = {};
        await Promise.all(
          missing.map(async (fid) => {
            try {
              const fr = await api.get<{ file: FileRow }>(
                `/businesses/${bizId}/files/${fid}`,
              );
              fetched[fid] = fr.data.file;
            } catch {
              // Fall back to a placeholder if the metadata fetch fails — the
              // download button still works using the file_id.
              fetched[fid] = {
                id: fid,
                original_name: fid.slice(0, 8),
                mime_type: 'application/octet-stream',
                byte_size: 0,
                storage_path: '',
              };
            }
          }),
        );
        setFiles((prev) => ({ ...prev, ...fetched }));
      }
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bizId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function patchItem(
    id: string,
    patch: {
      status?: ItemStatus;
      due_date?: string | null;
      notes?: string | null;
      document_file_id?: string | null;
    },
  ) {
    if (!bizId) return;
    setBusyId(id);
    setErr(null);
    try {
      await api.patch(`/businesses/${bizId}/compliance-items/${id}`, patch);
      await reload();
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setBusyId(null);
    }
  }

  async function uploadAndAttach(item: ComplianceItem, file: File) {
    if (!bizId) return;
    setBusyId(item.id);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      // Axios sets the multipart Content-Type (with boundary) automatically when the body is FormData.
      const fr = await api.post<FileRow>(`/businesses/${bizId}/files`, fd);
      const fileId = fr.data.id;
      // Cache file metadata so the row renders the filename immediately on refetch.
      setFiles((prev) => ({ ...prev, [fileId]: fr.data }));
      await api.patch(`/businesses/${bizId}/compliance-items/${item.id}`, {
        document_file_id: fileId,
      });
      const input = fileInputs.current[item.id];
      if (input) input.value = '';
      await reload();
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setBusyId(null);
    }
  }

  async function downloadFile(fileId: string, originalName: string) {
    if (!bizId) return;
    try {
      const r = await api.get(`/businesses/${bizId}/files/${fileId}/download`, {
        responseType: 'blob',
      });
      const blob = r.data as Blob;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = originalName || fileId;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revoke after a tick so the browser can finish the download.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e: unknown) {
      setErr(pickErr(e));
    }
  }

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Compliance</h1>

      {err && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {err}
        </div>
      )}

      {loading && items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            No compliance items for this business yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const file = item.document_file_id ? files[item.document_file_id] : null;
            const fileName = file?.original_name ?? item.document_file_id?.slice(0, 8) ?? '';
            const isBusy = busyId === item.id;
            return (
              <Card key={item.id}>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <CardTitle className="text-base">{ITEM_LABELS[item.item_key]}</CardTitle>
                    <div className="flex items-center gap-2">
                      <Label className="text-xs text-muted-foreground">Status</Label>
                      <select
                        className="h-9 rounded-md border bg-background px-2 text-sm"
                        value={item.status}
                        disabled={isBusy}
                        onChange={(e) =>
                          void patchItem(item.id, { status: e.target.value as ItemStatus })
                        }
                      >
                        {(Object.keys(STATUS_LABELS) as ItemStatus[]).map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABELS[s]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label className="text-xs text-muted-foreground">Due date</Label>
                      <Input
                        type="date"
                        defaultValue={item.due_date ?? ''}
                        disabled={isBusy}
                        onBlur={(e) => {
                          const v = e.target.value;
                          const next = v.trim().length > 0 ? v : null;
                          if (next !== (item.due_date ?? null)) {
                            void patchItem(item.id, { due_date: next });
                          }
                        }}
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Document</Label>
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          ref={(el) => {
                            fileInputs.current[item.id] = el;
                          }}
                          type="file"
                          disabled={isBusy}
                          className="block w-full flex-1 text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm hover:file:bg-muted"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void uploadAndAttach(item, f);
                          }}
                        />
                        {item.document_file_id && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              void downloadFile(item.document_file_id!, fileName)
                            }
                          >
                            View document
                          </Button>
                        )}
                      </div>
                      {item.document_file_id && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Attached: {fileName}
                        </p>
                      )}
                    </div>
                  </div>

                  <div>
                    <Label className="text-xs text-muted-foreground">Notes</Label>
                    <textarea
                      key={item.notes ?? ''}
                      className="mt-1 w-full rounded-md border bg-background px-2 py-1 text-sm"
                      placeholder="Notes…"
                      defaultValue={item.notes ?? ''}
                      rows={2}
                      disabled={isBusy}
                      onBlur={(e) => {
                        const v = e.target.value;
                        const next = v.trim().length > 0 ? v : null;
                        if (next !== (item.notes ?? null)) {
                          void patchItem(item.id, { notes: next });
                        }
                      }}
                    />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
