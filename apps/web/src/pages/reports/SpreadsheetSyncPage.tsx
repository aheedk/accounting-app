import { useState } from 'react';
import { DateInput } from '@/components/ui/date-input';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function pickErr(e: unknown): string {
  return (e as { response?: { data?: { error?: { message?: string } } } } | undefined)
    ?.response?.data?.error?.message ?? 'Failed';
}

// Reuses the blob-download pattern from ReceiptsPage so users get a real CSV file
// rather than an in-browser navigation that strips the Content-Disposition filename.
async function downloadBlob(url: string, params: Record<string, string>, filename: string) {
  const r = await api.get(url, { params, responseType: 'blob' });
  const blob = r.data as Blob;
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
}

export default function SpreadsheetSyncPage() {
  const [bizId] = useActiveBusinessId();
  const today = new Date().toISOString().slice(0, 10);

  const [tbAsOf, setTbAsOf] = useState(today);
  const [tbBusy, setTbBusy] = useState(false);
  const [tbErr, setTbErr] = useState<string | null>(null);

  const [jeFrom, setJeFrom] = useState('');
  const [jeTo, setJeTo] = useState(today);
  const [jeBusy, setJeBusy] = useState(false);
  const [jeErr, setJeErr] = useState<string | null>(null);

  if (!bizId) return <div>Pick a business.</div>;

  async function downloadTrialBalance() {
    setTbBusy(true);
    setTbErr(null);
    try {
      await downloadBlob(
        `/businesses/${bizId}/csv-exports/trial-balance`,
        { as_of: tbAsOf },
        `trial-balance-${tbAsOf}.csv`,
      );
    } catch (e: unknown) {
      setTbErr(pickErr(e));
    } finally {
      setTbBusy(false);
    }
  }

  async function downloadJournalEntries() {
    setJeBusy(true);
    setJeErr(null);
    try {
      const params: Record<string, string> = {};
      if (jeFrom) params.from = jeFrom;
      if (jeTo) params.to = jeTo;
      await downloadBlob(
        `/businesses/${bizId}/csv-exports/journal-entries`,
        params,
        `journal-entries-${jeFrom || 'all'}-to-${jeTo || 'all'}.csv`,
      );
    } catch (e: unknown) {
      setJeErr(pickErr(e));
    } finally {
      setJeBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Spreadsheet Sync</h1>
      <p className="text-sm text-muted-foreground">
        Download canned CSV exports for use in spreadsheets. Custom reports can be exported via the Custom Reports page.
      </p>

      <Card>
        <CardHeader><CardTitle>Trial Balance</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label>As of date</Label>
              <DateInput value={tbAsOf} onChange={e => setTbAsOf(e.target.value)} />
            </div>
            <Button type="button" disabled={tbBusy || !tbAsOf} onClick={downloadTrialBalance}>
              {tbBusy ? 'Downloading…' : 'Download CSV'}
            </Button>
          </div>
          {tbErr && <p className="text-sm text-destructive">{tbErr}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Journal Entry Lines</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label>From date</Label>
              <DateInput value={jeFrom} onChange={e => setJeFrom(e.target.value)} />
            </div>
            <div>
              <Label>To date</Label>
              <DateInput value={jeTo} onChange={e => setJeTo(e.target.value)} />
            </div>
            <Button type="button" disabled={jeBusy} onClick={downloadJournalEntries}>
              {jeBusy ? 'Downloading…' : 'Download CSV'}
            </Button>
          </div>
          {jeErr && <p className="text-sm text-destructive">{jeErr}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
