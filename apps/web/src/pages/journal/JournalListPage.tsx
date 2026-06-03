import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/DataTable';

type JE = { id: string; entry_date: string; memo: string | null; status: string; source_type: string };

function fmtShortDate(iso: string) {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

export default function JournalListPage() {
  const [bizId] = useActiveBusinessId();
  const [entries, setEntries] = useState<JE[]>([]);
  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/journal-entries`).then(r => setEntries(r.data.entries));
  }, [bizId]);

  const columns: Column<JE>[] = [
    { key: 'entry_date', header: 'Date', sortable: true, sortValue: r => Date.parse(r.entry_date), render: r => <span className="whitespace-nowrap">{fmtShortDate(r.entry_date)}</span> },
    { key: 'status', header: 'Status', sortable: true, sortValue: r => r.status, render: r => <span className="capitalize">{r.status}</span> },
    { key: 'source_type', header: 'Source', sortable: true, sortValue: r => r.source_type, render: r => <span className="capitalize">{r.source_type}</span> },
    { key: 'memo', header: 'Memo', sortable: true, sortValue: r => r.memo ?? '', render: r => r.memo || <span className="text-muted-foreground">—</span> },
  ];

  if (!bizId) return <div>Pick a business.</div>;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Journal Entries</h1>
        <Button asChild><Link to="/journal/new">New entry</Link></Button>
      </div>
      <Card><CardContent className="p-0">
        <DataTable
          rows={entries}
          getRowId={r => r.id}
          columns={columns}
          defaultSortKey="entry_date"
          defaultSortDir="desc"
          downloadable={{ filename: 'journal-entries', title: 'Journal Entries' }}
          actions={r => (
            <span className="inline-flex items-center gap-2">
              <Link className="text-primary hover:underline" to={`/journal/${r.id}`}>View/Edit</Link>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </span>
          )}
          emptyMessage="No journal entries."
        />
      </CardContent></Card>
    </div>
  );
}
