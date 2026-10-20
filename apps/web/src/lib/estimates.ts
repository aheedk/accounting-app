// Estimates as the API returns them (docs/specs/2026-10-20-estimates-design.md).

export type EstimateStatus = 'pending' | 'accepted' | 'rejected' | 'closed';
/** Expired is shown, not stored: a pending estimate past its expiration date. */
export type EstimateShownStatus = EstimateStatus | 'expired';

export type Estimate = {
  id: string;
  estimate_number: string;
  customer_id: string;
  customer_name: string;
  estimate_date: string;
  expiration_date: string | null;
  status: EstimateStatus;
  memo: string | null;
  subtotal: string;
  tax_total: string;
  total: string;
  accepted_by: string | null;
  accepted_date: string | null;
  invoice_id: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type EstimateLine = {
  id: string;
  line_number: number;
  inventory_item_id: string | null;
  description: string;
  quantity: string;
  unit_price: string;
  revenue_account_id: string;
  tax_code_id: string | null;
  line_subtotal: string;
  tax_amount: string;
  line_total: string;
};

export type EstimateDetail = { estimate: Estimate; lines: EstimateLine[]; invoice_number: string | null };

export const ESTIMATE_STATUS_LABELS: Record<EstimateShownStatus, string> = {
  pending: 'Pending', accepted: 'Accepted', rejected: 'Rejected', closed: 'Closed', expired: 'Expired',
};

export function estimateShownStatus(e: Pick<Estimate, 'status' | 'expiration_date'>, today: string): EstimateShownStatus {
  return e.status === 'pending' && e.expiration_date !== null && e.expiration_date < today ? 'expired' : e.status;
}

/** Still open: it can be edited, marked, or made into an invoice. Rejected ones are set back first. */
export function estimateCanInvoice(e: Pick<Estimate, 'status'>): boolean {
  return e.status === 'pending' || e.status === 'accepted';
}
