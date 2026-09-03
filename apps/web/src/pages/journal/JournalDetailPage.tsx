import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { pickErr } from '@/lib/apiErrors';
import JournalEntryEditor from './JournalEntryEditor';
import type { JournalEntryDetail } from './journalEntryTypes';

export default function JournalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [businessId] = useActiveBusinessId();
  const [data, setData] = useState<JournalEntryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!businessId || !id) return;
    setData(null);
    setError(null);
    api.get<JournalEntryDetail>(`/businesses/${businessId}/journal-entries/${id}`)
      .then(response => setData(response.data))
      .catch((requestError: unknown) => setError(pickErr(requestError)));
  }, [businessId, id]);

  if (!businessId) return <div>Pick a business.</div>;
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!data) return <div>Loading...</div>;
  return <JournalEntryEditor key={data.entry.id} existing={data} />;
}
