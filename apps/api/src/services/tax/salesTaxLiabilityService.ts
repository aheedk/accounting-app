import { type Kysely } from 'kysely';
import { addMoney, toMoneyString } from '@accounting/shared';
import type { DB } from '../../db/types.js';

// Sales Tax Liability (item 18): the tax charged on the invoices dated in the
// period, under each tax code, with the sales it was charged on. The same
// invoice lines that invoiceService.postInvoice credits each code's tax payable
// account from, so a code's tax ties out to what its invoices posted there.
// Credit memos carry no tax lines, so they are not in it.
// Spec: docs/specs/2026-10-07-report-set-design.md, section 3.

export type SalesTaxCode = {
  tax_code_id: string;
  code: string;
  name: string;
  /** The rate in effect at the end of the period, as a fraction (0.0875); null when none is. */
  rate: string | null;
  payable_account_id: string;
  payable_account_code: string;
  payable_account_name: string;
  /** The sales on lines carrying the code, before tax. */
  taxable_amount: string;
  tax_amount: string;
};

export type SalesTaxLiability = {
  /** Every invoice line's sales, before tax. */
  gross_sales: string;
  /** The lines with no tax code. */
  non_taxable_sales: string;
  /** By code. */
  codes: SalesTaxCode[];
};

/** Posted invoices (paid ones too; not drafts or voided ones) dated in the period. */
export async function salesTaxLiability(
  db: Kysely<DB>, q: { business_id: string; period_start: string; period_end: string },
): Promise<SalesTaxLiability> {
  const lines = await db.selectFrom('invoice_lines as l')
    .innerJoin('invoices as i', 'i.id', 'l.invoice_id')
    .select(['l.tax_code_id', 'l.line_subtotal', 'l.tax_amount'])
    .where('i.business_id', '=', q.business_id)
    .where('i.status', 'in', ['posted', 'paid'])
    .where('i.deleted_at', 'is', null)
    .where('i.issue_date', '>=', q.period_start)
    .where('i.issue_date', '<=', q.period_end)
    .execute();

  let gross = '0';
  let nonTaxable = '0';
  const byCode = new Map<string, { taxable: string; tax: string }>();
  for (const line of lines) {
    gross = toMoneyString(addMoney(gross, line.line_subtotal));
    if (line.tax_code_id === null) {
      nonTaxable = toMoneyString(addMoney(nonTaxable, line.line_subtotal));
      continue;
    }
    const own = byCode.get(line.tax_code_id) ?? { taxable: '0', tax: '0' };
    byCode.set(line.tax_code_id, {
      taxable: toMoneyString(addMoney(own.taxable, line.line_subtotal)),
      tax: toMoneyString(addMoney(own.tax, line.tax_amount)),
    });
  }
  const totals = { gross_sales: toMoneyString(gross), non_taxable_sales: toMoneyString(nonTaxable) };
  if (byCode.size === 0) return { ...totals, codes: [] };

  const ids = [...byCode.keys()];
  const codes = await db.selectFrom('tax_codes as tc')
    .innerJoin('chart_of_accounts as a', 'a.id', 'tc.tax_payable_account_id')
    .select(['tc.id', 'tc.code', 'tc.name', 'tc.tax_payable_account_id', 'a.code as account_code', 'a.name as account_name'])
    .where('tc.business_id', '=', q.business_id)
    .where('tc.id', 'in', ids)
    .orderBy('tc.code')
    .execute();
  const rates = await db.selectFrom('tax_rates')
    .select(['tax_code_id', 'rate'])
    .where('tax_code_id', 'in', ids)
    .where('effective_from', '<=', q.period_end)
    .where(eb => eb.or([eb('effective_to', 'is', null), eb('effective_to', '>=', q.period_end)]))
    .orderBy('effective_from', 'desc')
    .execute();
  const rateOf = new Map<string, string>();
  for (const r of rates) if (!rateOf.has(r.tax_code_id)) rateOf.set(r.tax_code_id, r.rate);

  return {
    ...totals,
    codes: codes.map(c => ({
      tax_code_id: c.id,
      code: c.code,
      name: c.name,
      rate: rateOf.get(c.id) ?? null,
      payable_account_id: c.tax_payable_account_id,
      payable_account_code: c.account_code,
      payable_account_name: c.account_name,
      taxable_amount: byCode.get(c.id)!.taxable,
      tax_amount: byCode.get(c.id)!.tax,
    })),
  };
}
