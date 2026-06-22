import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FileDown, Printer } from 'lucide-react';
import { downloadAsExcel } from '@/lib/download';

// Read-only payroll-side view of 1099 contractors. W-9 management lives on the
// AP Contractors page; this page focuses on initiating payment via a Bill.
// Decision: BillNewPage may not yet honor the ?vendor= query param — the link is
// still wired so the integration lands the moment the prefill support exists.

type Contractor = {
  id: string;
  business_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  is_1099: boolean;
  tax_id_last_four: string | null;
  tax_id_type: 'SSN' | 'EIN' | null;
  default_terms_days: number;
};

function maskTaxId(type: 'SSN' | 'EIN' | null, lastFour: string | null): string {
  if (!type || !lastFour) return '—';
  if (type === 'SSN') return `***-**-${lastFour}`;
  return `**-***${lastFour}`;
}

export default function PayrollContractorsPage() {
  const [bizId] = useActiveBusinessId();
  const navigate = useNavigate();
  const [items, setItems] = useState<Contractor[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [excelBusy, setExcelBusy] = useState(false);

  useEffect(() => {
    if (!bizId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get(`/businesses/${bizId}/contractors`)
      .then(r => {
        if (cancelled) return;
        setItems(r.data.vendors as Contractor[]);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)
          ?.response?.data?.error?.message;
        setError(msg ?? 'Failed to load contractors');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bizId]);

  function payContractor(c: Contractor) {
    navigate(`/ap/bills/new?vendor=${c.id}`);
  }

  if (!bizId) return <div>Pick a business.</div>;

  const dlHeaders = ['Name', 'Email', 'Tax ID Type', 'Tax ID (last 4)', '1099 Status'];
  const dlRows = () => items.map(c => [c.name, c.email ?? '', c.tax_id_type ?? '—', c.tax_id_last_four ?? '—', c.is_1099 ? 'Active 1099' : 'Inactive']);

  function handleExport() {
    setExcelBusy(true);
    try { downloadAsExcel(dlHeaders, dlRows(), 'payroll-contractors'); } finally { setExcelBusy(false); }
  }

  function handlePrint() {
    const rowsHtml = dlRows().map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>Payroll Contractors</title><style>body{font-family:Arial,sans-serif;font-size:11px;margin:24px}h2{margin-bottom:4px}p{color:#666;font-size:10px;margin-bottom:16px}table{width:100%;border-collapse:collapse}th{background:#f0f0f0;text-align:left;padding:5px 7px;border-bottom:2px solid #ccc;font-size:10px;text-transform:uppercase}td{padding:4px 7px;border-bottom:1px solid #e5e5e5}</style></head><body><h2>Payroll Contractors</h2><p>Generated ${new Date().toLocaleDateString()}</p><table><thead><tr>${dlHeaders.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rowsHtml}</tbody></table><script>window.onload=function(){window.print()}<\/script></body></html>`);
    win.document.close();
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Payroll Contractors</h1>
          <div className="flex items-center gap-2">
            <div className="relative group">
              <button className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50" onClick={handleExport} disabled={excelBusy} aria-label="Export to Excel">
                <FileDown className="h-4 w-4" />
              </button>
              <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">Export to Excel</div>
            </div>
            <div className="relative group">
              <button className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground" onClick={handlePrint} aria-label="Print">
                <Printer className="h-4 w-4" />
              </button>
              <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">Print</div>
            </div>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          1099 contractors paid through payroll. To manage W-9 details (tax ID, type, 1099
          flag), use the{' '}
          <Link to="/ap/contractors" className="text-primary underline">
            AP Contractors page
          </Link>
          .
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="text-left p-3">Name</th>
                <th className="text-left p-3">Email</th>
                <th className="text-left p-3">Tax ID Type</th>
                <th className="text-left p-3">Tax ID</th>
                <th className="text-left p-3">Status</th>
                <th className="text-right p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && !loading && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-sm text-muted-foreground">
                    No 1099 contractors yet. Mark a vendor as 1099 from the{' '}
                    <Link to="/ap/vendors" className="text-primary underline">
                      Vendors page
                    </Link>
                    .
                  </td>
                </tr>
              )}
              {loading && items.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-sm text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              )}
              {items.map(c => (
                <tr key={c.id} className="border-b last:border-b-0 align-top">
                  <td className="p-3">{c.name}</td>
                  <td className="p-3">{c.email ?? ''}</td>
                  <td className="p-3">
                    {c.tax_id_type ? (
                      <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                        {c.tax_id_type}
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        —
                      </span>
                    )}
                  </td>
                  <td className="p-3 font-mono">{maskTaxId(c.tax_id_type, c.tax_id_last_four)}</td>
                  <td className="p-3">
                    {c.is_1099 ? (
                      <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                        Active 1099
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        Inactive
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-right">
                    <Button size="sm" onClick={() => payContractor(c)}>
                      Pay contractor
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
