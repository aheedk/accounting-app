import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FileDown, Printer } from 'lucide-react';
import { downloadAsExcel } from '@/lib/download';
import { api } from '@/lib/apiClient';
import { pickErr } from '@/lib/apiErrors';
import { useActiveBusinessId } from '@/lib/business';
import { useCan } from '@/lib/roleAccess';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { DetailStatusBadge } from '@/components/ui/detail-page';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { fmtMoney } from '@/lib/money';
import { fmtLongDate, todayLocal } from '@/lib/dates';
import { AppSelect } from '@/components/ui/select';
import { printReport } from '@/lib/reportExport';
import {
  ESTIMATE_STATUS_LABELS, estimateCanInvoice, estimateShownStatus, type Estimate, type EstimateShownStatus,
} from '@/lib/estimates';

// Accounts Receivable → Estimates: quotes to customers, newest first.
// Spec: docs/specs/2026-10-20-estimates-design.md

type Listed = Estimate & { invoice_number: string | null };
type Row = Listed & { shown: EstimateShownStatus };
const FILTERS: EstimateShownStatus[] = ['pending', 'accepted', 'rejected', 'closed', 'expired'];

export default function EstimateListPage() {
  const [bizId] = useActiveBusinessId();
  const can = useCan();
  const nav = useNavigate();
  const [estimates, setEstimates] = useState<Listed[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<'' | EstimateShownStatus>('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function load() {
    if (!bizId) return;
    setLoadErr(null);
    setEstimates(null);
    api.get<{ estimates: Listed[] }>(`/businesses/${bizId}/estimates`)
      .then(r => setEstimates(r.data.estimates))
      .catch((e: unknown) => setLoadErr(pickErr(e)));
  }
  useEffect(load, [bizId]);

  const today = todayLocal();
  const rows: Row[] = useMemo(
    () => (estimates ?? [])
      .map(e => ({ ...e, shown: estimateShownStatus(e, today) }))
      .filter(e => !filter || e.shown === filter),
    [estimates, filter, today],
  );

  // The invoice is a draft; the invoice's page is where an accountant posts it.
  async function makeInvoice(estimate: Row) {
    setBusyId(estimate.id); setErr(null);
    try {
      const r = await api.post<{ invoice: { id: string } }>(`/businesses/${bizId}/estimates/${estimate.id}/convert`, { issue_date: todayLocal() });
      nav(`/invoices/${r.data.invoice.id}`);
    } catch (e: unknown) {
      setErr(pickErr(e));
      setBusyId(null);
    }
  }

  const columns: Column<Row>[] = [
    { key: 'estimate_date', header: 'Date', sortable: true, sortValue: r => r.estimate_date, render: r => <span className="whitespace-nowrap">{fmtLongDate(r.estimate_date)}</span> },
    { key: 'estimate_number', header: 'No.', sortable: true, sortValue: r => r.estimate_number, render: r => <span className="font-mono">{r.estimate_number}</span> },
    { key: 'customer', header: 'Customer', sortable: true, sortValue: r => r.customer_name, render: r => r.customer_name },
    { key: 'expiration_date', header: 'Expires', sortable: true, sortValue: r => r.expiration_date ?? '', render: r => (r.expiration_date ? <span className="whitespace-nowrap">{fmtLongDate(r.expiration_date)}</span> : <span className="text-muted-foreground">—</span>) },
    { key: 'total', header: 'Amount', sortable: true, align: 'right', sortValue: r => Number(r.total), render: r => <span className="font-mono">{fmtMoney(r.total)}</span> },
    { key: 'status', header: 'Status', sortable: true, sortValue: r => ESTIMATE_STATUS_LABELS[r.shown], render: r => <DetailStatusBadge status={r.shown} label={ESTIMATE_STATUS_LABELS[r.shown]} /> },
  ];

  if (!bizId) return <div>Pick a business.</div>;

  const dlHeaders = columns.map(c => c.header);
  const dlRows = () => rows.map(row => columns.map(col => (col.sortValue ? String(col.sortValue(row)) : '')));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Estimates</h1>
        <div className="flex flex-wrap items-center gap-3">
          <AppSelect className="h-9 rounded-md border bg-background px-3 text-sm" value={filter} onChange={e => setFilter(e.target.value as '' | EstimateShownStatus)} aria-label="Status">
            <option value="">All statuses</option>
            {FILTERS.map(s => <option key={s} value={s}>{ESTIMATE_STATUS_LABELS[s]}</option>)}
          </AppSelect>
          <button className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            onClick={() => downloadAsExcel(dlHeaders, dlRows(), 'estimates', { title: 'Estimates' })} aria-label="Export to Excel" title="Export to Excel">
            <FileDown className="h-4 w-4" />
          </button>
          <button className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            onClick={() => printReport({ title: 'Estimates', headers: dlHeaders, rows: dlRows() })} aria-label="Print" title="Print">
            <Printer className="h-4 w-4" />
          </button>
          {can.staff && <Button asChild><Link to="/estimates/new">New estimate</Link></Button>}
        </div>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <Card><CardContent className="p-0">
        {loadErr ? <ErrorState message={loadErr} onRetry={load} /> : (
          <DataTable
            rows={rows}
            getRowId={r => r.id}
            columns={columns}
            loading={estimates === null}
            defaultSortKey="estimate_date"
            defaultSortDir="desc"
            actionsHeader="Action"
            actions={r => (
              <span className="inline-flex items-center gap-2">
                <Link className="text-link hover:underline" to={`/estimates/${r.id}`}>View</Link>
                {can.staff && estimateCanInvoice(r) && (
                  <>
                    <span className="text-muted-foreground/50">|</span>
                    <button type="button" className="text-link hover:underline disabled:opacity-50" disabled={busyId !== null} onClick={() => void makeInvoice(r)}>
                      {busyId === r.id ? 'Creating…' : 'Create invoice'}
                    </button>
                  </>
                )}
                {r.status === 'closed' && r.invoice_id && (
                  <>
                    <span className="text-muted-foreground/50">|</span>
                    <Link className="text-link hover:underline" to={`/invoices/${r.invoice_id}`}>Invoice {r.invoice_number}</Link>
                  </>
                )}
              </span>
            )}
            emptyMessage={<EmptyState title={filter ? 'No estimates with this status' : 'No estimates yet'}
              hint="Quote a customer before the work; an accepted estimate becomes an invoice."
              {...(can.staff && !filter ? { actionLabel: 'New estimate', actionTo: '/estimates/new' } : {})} />}
          />
        )}
      </CardContent></Card>
    </div>
  );
}
