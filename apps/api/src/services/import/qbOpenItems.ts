import type { Transaction } from 'kysely';
import type { schemas } from '@accounting/shared';
import { addMoney, isZero, toMoneyString } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import { scopeBusiness, type ServiceCtx } from '../../lib/ctx.js';
import { getOrCreateOpeningBalanceEquity } from '../core/chartOfAccountsService.js';
import * as invoiceSvc from '../ar/invoiceService.js';
import * as creditMemoSvc from '../ar/creditMemoService.js';
import * as billSvc from '../ap/billService.js';
import * as vendorCreditSvc from '../ap/vendorCreditService.js';
import {
  createBatch, dateProblems, emptyResult, guardProblems, type QbImportResult, type QbRecord,
} from './qbBatches.js';
import { makeNameMatcher, norm } from './qbMatch.js';

// Step 3 of moving a client from QuickBooks: each open invoice and unpaid bill
// as a document of its own, for its open balance, so a payment made after
// cutover has something to be applied to. Each is posted against Opening
// Balance Equity; the opening entry then needs nothing for Accounts
// Receivable or Payable. Money on account (a credit memo, a payment not yet
// applied) comes in as a credit for the customer or vendor.
// Spec: docs/specs/2026-10-28-quickbooks-import-design.md.

const MEMO = 'Open balance from QuickBooks';

/** Days between two dates, for the terms of a bill or invoice that has a due date. */
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

/** A number the app has not used yet: QuickBooks' own, else one made up, with -2, -3... when taken. */
function uniqueNumber(taken: Set<string>, wanted: string | null | undefined, fallback: string): string {
  const base = wanted?.trim() || fallback;
  let n = base;
  for (let k = 2; taken.has(norm(n)); k++) n = `${base}-${k}`;
  taken.add(norm(n));
  return n;
}

export async function importOpenInvoices(trx: Transaction<DB>, ctx: ServiceCtx, input: schemas.QbOpenInvoicesImport): Promise<QbImportResult> {
  const business_id = scopeBusiness(ctx);
  const result = emptyResult();
  result.problems.push(...await guardProblems(trx, business_id, 'open_invoices', input.cutover_date));
  const rows = input.rows.map((row, i) => ({ row, i })).filter(({ row }) => !isZero(row.amount));
  result.problems.push(...await dateProblems(trx, business_id, input.cutover_date, rows.map(({ row, i }) => ({ row: i, date: row.date }))));

  const customers = await trx.selectFrom('customers').select(['id', 'name'])
    .where('business_id', '=', business_id).where('deleted_at', 'is', null).execute();
  const customerOf = makeNameMatcher(customers);
  for (const { row, i } of rows) {
    if (!customerOf(row.customer)) result.problems.push({ row: i, message: `No customer named "${row.customer}". Bring the customers in first` });
  }
  if (result.problems.length > 0) return result;

  const obe = await getOrCreateOpeningBalanceEquity(trx, ctx, business_id);
  const used = await trx.selectFrom('invoices').select('invoice_number').where('business_id', '=', business_id).execute();
  const taken = new Set(used.map(u => norm(u.invoice_number)));
  const records: QbRecord[] = [];
  let invoiceTotal = '0';
  let creditTotal = '0';
  let renumbered = 0;

  for (const { row, i } of rows) {
    const customer = customerOf(row.customer)!;
    const amount = toMoneyString(row.amount);
    const isInvoiceType = norm(row.type) === 'invoice';
    if (Number(amount) > 0) {
      const wanted = row.number?.trim() || null;
      const number = uniqueNumber(taken, wanted, `QB-${i + 1}`);
      if (wanted && number !== wanted) renumbered++;
      const due = row.due_date && row.due_date >= row.date ? row.due_date : row.date;
      const draft = await invoiceSvc.createDraft(trx, ctx, {
        business_id, customer_id: customer.id, invoice_number: number,
        issue_date: row.date, due_date: due,
        memo: isInvoiceType ? MEMO : `${MEMO} (${row.type}${row.number ? ` ${row.number}` : ''})`,
        terms: row.terms?.trim() || (due !== row.date ? `Net ${daysBetween(row.date, due)}` : null),
        lines: [{ description: MEMO, quantity: '1', unit_price: amount, revenue_account_id: obe.id, tax_code_id: null }],
      });
      await invoiceSvc.postInvoice(trx, ctx, { invoice_id: draft.invoice.id });
      records.push({ entity_type: 'invoice', entity_id: draft.invoice.id });
      invoiceTotal = toMoneyString(addMoney(invoiceTotal, amount));
    } else {
      const credit = toMoneyString(amount.replace('-', ''));
      const cm = await creditMemoSvc.createDraft(trx, ctx, {
        business_id, customer_id: customer.id, memo_date: row.date, amount: credit, revenue_account_id: obe.id,
        memo: `${MEMO}: ${row.type}${row.number ? ` ${row.number}` : ''}`,
      });
      await creditMemoSvc.postCreditMemo(trx, ctx, { credit_memo_id: cm.id });
      records.push({ entity_type: 'credit_memo', entity_id: cm.id });
      creditTotal = toMoneyString(addMoney(creditTotal, credit));
    }
  }

  if (renumbered > 0) result.notes.push(`${renumbered} had a number already used here, so they end in -2, -3...`);
  const net = toMoneyString(addMoney(invoiceTotal, `-${creditTotal}`));
  result.counts = { invoices: records.filter(r => r.entity_type === 'invoice').length, credits: records.filter(r => r.entity_type === 'credit_memo').length };
  result.preview = { invoice_total: invoiceTotal, credit_total: creditTotal, net };
  if (records.length > 0) {
    result.batch_id = await createBatch(trx, ctx, {
      step: 'open_invoices', cutover_date: input.cutover_date, file_name: input.file_name ?? null,
      summary: { ...result.counts, invoice_total: invoiceTotal, credit_total: creditTotal, net }, records,
    });
  }
  return result;
}

export async function importOpenBills(trx: Transaction<DB>, ctx: ServiceCtx, input: schemas.QbOpenBillsImport): Promise<QbImportResult> {
  const business_id = scopeBusiness(ctx);
  const result = emptyResult();
  result.problems.push(...await guardProblems(trx, business_id, 'open_bills', input.cutover_date));
  const rows = input.rows.map((row, i) => ({ row, i })).filter(({ row }) => !isZero(row.amount));
  result.problems.push(...await dateProblems(trx, business_id, input.cutover_date, rows.map(({ row, i }) => ({ row: i, date: row.date }))));

  const vendors = await trx.selectFrom('vendors').select(['id', 'name'])
    .where('business_id', '=', business_id).where('deleted_at', 'is', null).execute();
  const vendorOf = makeNameMatcher(vendors);
  for (const { row, i } of rows) {
    if (!vendorOf(row.vendor)) result.problems.push({ row: i, message: `No vendor named "${row.vendor}". Bring the vendors in first` });
  }
  if (result.problems.length > 0) return result;

  const obe = await getOrCreateOpeningBalanceEquity(trx, ctx, business_id);
  // Bill numbers are one to a company here; in QuickBooks two vendors can share one, and a bill can have none.
  const used = await trx.selectFrom('bills').select('bill_number').where('business_id', '=', business_id).execute();
  const taken = new Set(used.map(u => norm(u.bill_number)));
  const records: QbRecord[] = [];
  let billTotal = '0';
  let creditTotal = '0';
  let renumbered = 0;

  for (const { row, i } of rows) {
    const vendor = vendorOf(row.vendor)!;
    const amount = toMoneyString(row.amount);
    if (Number(amount) > 0) {
      const number = uniqueNumber(taken, row.number, `QB-${row.date}-${i + 1}`);
      if (row.number?.trim() && number !== row.number.trim()) renumbered++;
      const due = row.due_date && row.due_date >= row.date ? row.due_date : row.date;
      const draft = await billSvc.createDraft(trx, ctx, {
        business_id, vendor_id: vendor.id, bill_number: number, bill_date: row.date, due_date: due,
        memo: norm(row.type) === 'bill' ? MEMO : `${MEMO} (${row.type}${row.number ? ` ${row.number}` : ''})`,
        terms: row.terms?.trim() || (due !== row.date ? `Net ${daysBetween(row.date, due)}` : null),
        lines: [{ description: MEMO, quantity: '1', unit_price: amount, expense_account_id: obe.id }],
      });
      await billSvc.postBill(trx, ctx, { bill_id: draft.bill.id });
      records.push({ entity_type: 'bill', entity_id: draft.bill.id });
      billTotal = toMoneyString(addMoney(billTotal, amount));
    } else {
      const credit = toMoneyString(amount.replace('-', ''));
      const vc = await vendorCreditSvc.createDraft(trx, ctx, {
        business_id, vendor_id: vendor.id, credit_date: row.date, amount: credit, offset_account_id: obe.id,
        memo: `${MEMO}: ${row.type}${row.number ? ` ${row.number}` : ''}`,
      });
      await vendorCreditSvc.postVendorCredit(trx, ctx, { vendor_credit_id: vc.id });
      records.push({ entity_type: 'vendor_credit', entity_id: vc.id });
      creditTotal = toMoneyString(addMoney(creditTotal, credit));
    }
  }

  if (renumbered > 0) result.notes.push(`${renumbered} had a number already used here (two vendors' bills can share one in QuickBooks), so they end in -2, -3...`);
  const net = toMoneyString(addMoney(billTotal, `-${creditTotal}`));
  result.counts = { bills: records.filter(r => r.entity_type === 'bill').length, credits: records.filter(r => r.entity_type === 'vendor_credit').length };
  result.preview = { bill_total: billTotal, credit_total: creditTotal, net };
  if (records.length > 0) {
    result.batch_id = await createBatch(trx, ctx, {
      step: 'open_bills', cutover_date: input.cutover_date, file_name: input.file_name ?? null,
      summary: { ...result.counts, bill_total: billTotal, credit_total: creditTotal, net }, records,
    });
  }
  return result;
}
