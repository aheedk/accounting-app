import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

type JE = { id: string; entry_date: string; memo: string | null; status: string; source_type: string };

export default function JournalListPage() {
  const [bizId] = useActiveBusinessId();
  const [entries, setEntries] = useState<JE[]>([]);
  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/journal-entries`).then(r => setEntries(r.data.entries));
  }, [bizId]);
  if (!bizId) return <div>Pick a business.</div>;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Journal Entries</h1>
        <Button asChild><Link to="/journal/new">New entry</Link></Button>
      </div>
      <Card><CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              <th className="text-left p-3">Date</th>
              <th className="text-left p-3">Status</th>
              <th className="text-left p-3">Source</th>
              <th className="text-left p-3">Memo</th>
              <th className="text-left p-3"></th>
            </tr>
          </thead>
          <tbody>
            {entries.map(e => (
              <tr key={e.id} className="border-b last:border-b-0">
                <td className="p-3">{e.entry_date}</td>
                <td className="p-3">{e.status}</td>
                <td className="p-3">{e.source_type}</td>
                <td className="p-3">{e.memo ?? ''}</td>
                <td className="p-3"><Link className="text-primary underline" to={`/journal/${e.id}`}>view</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}
