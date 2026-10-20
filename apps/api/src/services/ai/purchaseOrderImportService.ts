import type { Transaction } from 'kysely';
import { createDraft, getNextInvoiceNumber, postInvoice, type InvoiceLineInput } from '../ar/invoiceService.js';
import type { DB } from '../../db/types.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type PurchaseOrderLine = { description?: string; quantity?: string; unit_price?: string; amount?: string };

/**
 * Invoice lines for a customer's purchase order. Quantity and unit price stay as
 * the order has them. A line whose numbers do not multiply out to its amount, or
 * an order that carries tax, falls back to one unit at the line amount with the
 * tax spread by amount, the way an imported AR invoice is built.
 */
export function purchaseOrderInvoiceLines(
  lines: PurchaseOrderLine[],
  included: { index: number; account_id: string }[],
  totals: { subtotal: string | null; tax_amount: string | null },
): InvoiceLineInput[] {
  const num = (v: string | undefined) => (v === undefined || v.trim() === '' ? NaN : Number(v.replace(/[$,]/g, '')));
  const amountOf = (li: PurchaseOrderLine | undefined) => {
    const amount = num(li?.amount);
    if (Number.isFinite(amount)) return amount;
    const product = num(li?.quantity) * num(li?.unit_price);
    return Number.isFinite(product) ? product : 0;
  };
  const tax = Number(totals.tax_amount ?? 0) || 0;
  const subtotal = Number(totals.subtotal ?? 0) || included.reduce((s, item) => s + amountOf(lines[item.index]), 0);

  return included.map(item => {
    const li = lines[item.index];
    const amount = amountOf(li);
    const qty = num(li?.quantity);
    const price = num(li?.unit_price);
    const keepsUnits = tax === 0 && qty > 0 && Number.isFinite(price) && Math.abs(qty * price - amount) < 0.01;
    const lineTax = tax > 0 && subtotal > 0 ? (amount / subtotal) * tax : 0;
    return {
      description: li?.description ?? '',
      quantity: keepsUnits ? String(qty) : '1',
      unit_price: keepsUnits ? price.toFixed(4) : (amount + lineTax).toFixed(2),
      revenue_account_id: item.account_id,
      tax_code_id: null,
    };
  });
}

/**
 * Turns an approved purchase order into a posted sales invoice. The invoice takes
 * the next invoice number; the order number is the customer's, so it goes in the
 * memo. Terms and the due date follow the customer's default terms.
 */
export async function createInvoiceFromPurchaseOrder(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  args: {
    business_id: string;
    customer_id: string;
    po_number: string | null;
    issue_date: string;
    lines: InvoiceLineInput[];
  },
) {
  const customer = await trx.selectFrom('customers').select('default_terms_days')
    .where('id', '=', args.customer_id).where('business_id', '=', args.business_id).executeTakeFirstOrThrow();
  const days = Number(customer.default_terms_days) || 0;
  const due = new Date(`${args.issue_date}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() + days);

  const { invoice } = await createDraft(trx, ctx, {
    business_id: args.business_id,
    customer_id: args.customer_id,
    invoice_number: await getNextInvoiceNumber(trx, args.business_id),
    issue_date: args.issue_date,
    due_date: due.toISOString().slice(0, 10),
    memo: args.po_number ? `Customer PO #${args.po_number}` : 'From customer purchase order',
    terms: days === 0 ? 'Due on receipt' : `Net ${days}`,
    lines: args.lines,
  });
  await postInvoice(trx, ctx, { invoice_id: invoice.id });
  return invoice;
}
