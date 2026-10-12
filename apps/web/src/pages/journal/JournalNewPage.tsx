import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { pickErr } from '@/lib/apiErrors';
import { useActiveBusinessId } from '@/lib/business';
import JournalEntryEditor from './JournalEntryEditor';
import type { JournalEntryDetail } from './journalEntryTypes';

export default function JournalNewPage() {
  const [businessId] = useActiveBusinessId();
  const [searchParams] = useSearchParams();
  const copyId = searchParams.get('copy');
  // ?reverse=<id>: the form opens as that entry's reversal, to be changed and then posted.
  const reverseId = searchParams.get('reverse');
  const [copySource, setCopySource] = useState<JournalEntryDetail | null>(null);
  const [reverseSource, setReverseSource] = useState<JournalEntryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCopySource(null);
    setError(null);
    if (!copyId || !businessId) return;
    api.get<JournalEntryDetail>(`/businesses/${businessId}/journal-entries/${copyId}`)
      .then(response => {
        if (!response.data.is_standalone_manual) {
          setError('Only standalone manual or adjusting journal entries can be copied.');
          return;
        }
        setCopySource(response.data);
      })
      .catch((requestError: unknown) => setError(pickErr(requestError)));
  }, [businessId, copyId]);

  useEffect(() => {
    setReverseSource(null);
    if (!reverseId || !businessId) return;
    api.get<JournalEntryDetail>(`/businesses/${businessId}/journal-entries/${reverseId}`)
      .then(response => {
        if (!response.data.can_reverse) {
          setError(response.data.reversal_block_reason ?? 'This journal entry cannot be reversed.');
          return;
        }
        setReverseSource(response.data);
      })
      .catch((requestError: unknown) => setError(pickErr(requestError)));
  }, [businessId, reverseId]);

  if ((copyId || reverseId) && !businessId) return <div>Pick a business.</div>;
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (reverseId && !reverseSource) return <div>Loading journal entry...</div>;
  if (reverseSource) return <JournalEntryEditor key={`${businessId}-reverse-${reverseId ?? ''}`} reverseSource={reverseSource} />;
  if (copyId && !copySource) return <div>Loading journal entry copy...</div>;
  if (copySource) return <JournalEntryEditor key={`${businessId}-${copyId ?? 'copy'}`} copySource={copySource} />;
  return <JournalEntryEditor key={`${businessId ?? 'none'}-new`} />;
}
