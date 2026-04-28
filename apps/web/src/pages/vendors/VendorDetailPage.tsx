import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmtMoney } from '@/lib/money';

type Vendor = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  tax_id: string | null;
  is_1099: boolean;
  default_terms_days: number;
};
type BillSummary = { id: string; bill_number: string; bill_date: string; due_date: string; status: string; total: string };

export default function VendorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [bizId] = useActiveBusinessId();
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [bills, setBills] = useState<BillSummary[]>([]);
  useEffect(() => {
    if (!bizId || !id) return;
    api.get(`/businesses/${bizId}/vendors/${id}`).then(r => setVendor(r.data));
    api.get(`/businesses/${bizId}/bills`, { params: { vendor_id: id } }).then(r => setBills(r.data.bills));
  }, [bizId, id]);
  if (!vendor) return <div>Loading…</div>;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{vendor.name}</h1>
      <Card><CardHeader><CardTitle>Contact</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-1">
          <div>Email: {vendor.email ?? '—'}</div>
          <div>Phone: {vendor.phone ?? '—'}</div>
          <div>Terms: {vendor.default_terms_days}d</div>
          {vendor.tax_id && <div>Tax ID: {vendor.tax_id}</div>}
          <div>1099: {vendor.is_1099 ? 'Yes' : 'No'}</div>
        </CardContent>
      </Card>
      <Card><CardHeader><CardTitle>Bills</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40"><tr><th className="text-left p-3">#</th><th className="text-left p-3">Date</th><th className="text-left p-3">Status</th><th className="text-right p-3">Total</th><th></th></tr></thead>
            <tbody>{bills.map((b: BillSummary) => (
              <tr key={b.id} className="border-b last:border-b-0">
                <td className="p-3 font-mono">{b.bill_number}</td>
                <td className="p-3">{b.bill_date}</td>
                <td className="p-3">{b.status}</td>
                <td className="p-3 text-right">{fmtMoney(b.total)}</td>
                <td className="p-3"><Link className="text-primary underline" to={`/ap/bills/${b.id}`}>view</Link></td>
              </tr>
            ))}</tbody>
          </table>
        </CardContent></Card>
    </div>
  );
}
