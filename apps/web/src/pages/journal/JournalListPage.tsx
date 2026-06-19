import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Settings } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';

type JE = { id: string; entry_date: string; memo: string | null; status: string; source_type: string };

function fmtShortDate(iso: string) {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

function statusBadge(status: string) {
  const base = 'inline-flex rounded-full px-2 py-0.5 text-xs font-medium';
  switch (status) {
    case 'draft':
      return <span className={`${base} bg-amber-100 text-amber-800`}>Draft</span>;
    case 'posted':
      return <span className={`${base} bg-emerald-100 text-emerald-800`}>Posted</span>;
    case 'void':
    case 'voided':
      return <span className={`${base} bg-muted text-muted-foreground`}>Void</span>;
    default:
      return <span className={`${base} capitalize`}>{status}</span>;
  }
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'posted', label: 'Posted' },
  { value: 'void', label: 'Void' },
];

export default function JournalListPage() {
  const [bizId] = useActiveBusinessId();
  const [entries, setEntries] = useState<JE[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/journal-entries`).then(r => setEntries(r.data.entries));
  }, [bizId]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter(e => {
      if (statusFilter !== 'all' && e.status !== statusFilter) return false;
      if (q && !(e.memo ?? '').toLowerCase().includes(q) && !e.source_type.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [entries, statusFilter, search]);

  const columns: Column<JE>[] = [
    { key: 'entry_date', header: 'Date', sortable: true, sortValue: r => Date.parse(r.entry_date), render: r => <span className="whitespace-nowrap">{fmtShortDate(r.entry_date)}</span> },
    { key: 'memo', header: 'Memo', sortable: true, sortValue: r => r.memo ?? '', render: r => r.memo ? <span className="font-medium">{r.memo}</span> : <span className="text-muted-foreground">—</span> },
    { key: 'source_type', header: 'Source', sortable: true, sortValue: r => r.source_type, render: r => <span className="capitalize text-muted-foreground">{r.source_type.replace(/_/g, ' ')}</span> },
    { key: 'status', header: 'Status', sortable: true, sortValue: r => r.status, render: r => statusBadge(r.status) },
  ];

  if (!bizId) return <div>Pick a business.</div>;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Journal Entries</h1>
        <Button asChild><Link to="/journal/new">New entry</Link></Button>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <div className="mb-1 text-xs text-muted-foreground">Status</div>
          <select className="h-9 rounded-md border bg-background px-3 text-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="min-w-[14rem] flex-1">
          <div className="mb-1 text-xs text-muted-foreground">Search</div>
          <Input className="h-9" placeholder="Search by memo or source" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      <Card><CardContent className="p-0">
        <DataTable
          rows={rows}
          getRowId={r => r.id}
          columns={columns}
          defaultSortKey="entry_date"
          defaultSortDir="desc"
          downloadable={{ filename: 'journal-entries', title: 'Journal Entries' }}
          actionsHeader={<span className="inline-flex items-center gap-1.5">Action <Settings className="h-3.5 w-3.5" /></span>}
          actions={r => (
            <span className="inline-flex items-center gap-2">
              <Link className="text-primary hover:underline" to={`/journal/${r.id}`}>View/Edit</Link>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </span>
          )}
          emptyMessage={<EmptyState title="No journal entries found" hint="Adjust the filters above, or record a manual journal entry." actionLabel="New entry" actionTo="/journal/new" />}
        />
      </CardContent></Card>
    </div>
  );
}
