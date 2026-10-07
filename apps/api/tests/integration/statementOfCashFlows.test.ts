import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeCustomer, makeVendor, makeBankAccount, seedYearPeriods, seedCoa } from '../helpers/factories.js';
import * as invoiceSvc from '../../src/services/ar/invoiceService.js';
import * as paymentSvc from '../../src/services/ar/paymentService.js';
import * as billSvc from '../../src/services/ap/billService.js';
import * as ledger from '../../src/services/core/ledgerService.js';
import * as rpt from '../../src/services/reports/statementOfCashFlowsService.js';
import * as pnl from '../../src/services/reports/profitLossService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-000000004007', ip_address: '127.0.0.1', user_agent: 'vitest' };

describe('Statement of Cash Flows', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('explains the change in cash as operating, investing and financing', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    await seedYearPeriods(t.db, biz.id, 2026);
    await seedCoa(t.db, biz.id);
    const account = async (code: string) => t.db.selectFrom('chart_of_accounts').selectAll()
      .where('business_id', '=', biz.id).where('code', '=', code).executeTakeFirstOrThrow();
    const [cash, revenue, expense, equipment, accumulated, depreciation, notes, equity] = await Promise.all(
      ['1020', '4010', '5200', '1500', '1510', '5910', '2500', '3010'].map(account));
    await makeBankAccount(t.db, biz.id, cash!.id);
    const customer = await makeCustomer(t.db, biz.id);
    const vendor = await makeVendor(t.db, biz.id);
    const post = (entry_date: string, memo: string, debit: string, credit: string, amount: string) =>
      t.db.transaction().execute(trx => ledger.postJournalEntry(trx, ctx, {
        business_id: biz.id, entry_date, source_type: 'manual', memo,
        lines: [
          { account_id: debit, debit: amount, credit: '0.0000', memo: null },
          { account_id: credit, debit: '0.0000', credit: amount, memo: null },
        ],
      }));

    // Before the period: the owner puts in 5,000. It is the opening cash, not this period's financing.
    await post('2026-03-15', 'Owner investment', cash!.id, equity!.id, '5000.0000');

    // April. Two invoices of 1,000; one is collected, one is still owed.
    const invoice = async (num: string) => {
      const d = await t.db.transaction().execute(trx => invoiceSvc.createDraft(trx, ctx, {
        business_id: biz.id, customer_id: customer.id, invoice_number: num,
        issue_date: '2026-04-05', due_date: '2026-05-05', memo: null, terms: null,
        lines: [{ description: 'Work', quantity: '1', unit_price: '1000.00', revenue_account_id: revenue!.id, tax_code_id: null }],
      }));
      await t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctx, { invoice_id: d.invoice.id }));
      return d.invoice.id;
    };
    const paidInvoice = await invoice('SCF-1');
    await invoice('SCF-2');
    const pay = await t.db.transaction().execute(trx => paymentSvc.createDraft(trx, ctx, {
      business_id: biz.id, customer_id: customer.id, payment_date: '2026-04-20', payment_method: 'check',
      reference: null, amount: '1000.00', cash_account_id: cash!.id, memo: null,
      initial_applications: [{ invoice_id: paidInvoice, applied_amount: '1000.00' }],
    }));
    await t.db.transaction().execute(trx => paymentSvc.postPayment(trx, ctx, { payment_id: pay.payment.id }));
    // A 300 rent bill, not yet paid.
    const bill = await t.db.transaction().execute(trx => billSvc.createDraft(trx, ctx, {
      business_id: biz.id, vendor_id: vendor.id, bill_number: 'SCF-B', bill_date: '2026-04-08', due_date: '2026-05-08',
      memo: null, terms: null,
      lines: [{ description: 'Rent', quantity: '1', unit_price: '300.00', expense_account_id: expense!.id }],
    }));
    await t.db.transaction().execute(trx => billSvc.postBill(trx, ctx, { bill_id: bill.bill.id }));
    await post('2026-04-10', 'Buy equipment', equipment!.id, cash!.id, '2000.0000');
    await post('2026-04-30', 'Depreciation', depreciation!.id, accumulated!.id, '100.0000');
    await post('2026-04-12', 'Bank loan', cash!.id, notes!.id, '4000.0000');
    // A void must leave no trace.
    const mistake = await post('2026-04-15', 'Entered by mistake', expense!.id, cash!.id, '777.0000');
    await t.db.transaction().execute(trx => ledger.voidJournalEntry(trx, ctx, { journal_entry_id: mistake.id, void_reason: 'Mistake' }));

    const r = await rpt.statementOfCashFlows(t.db, { business_id: biz.id, period_start: '2026-04-01', period_end: '2026-04-30' });

    // Net income 2,000 revenue - 300 rent - 100 depreciation = 1,600, the same as the P&L.
    const profit = await pnl.profitLoss(t.db, { business_id: biz.id, period_start: '2026-04-01', period_end: '2026-04-30' });
    expect(r.net_income).toBe('1600.0000');
    expect(r.net_income).toBe(profit.net_income);

    const adjustments = Object.fromEntries(r.operating_adjustments.map(l => [l.account_name, l.amount]));
    expect(adjustments).toEqual({
      'Accounts Receivable': '-1000.0000',     // earned, not yet collected
      'Accumulated Depreciation': '100.0000',  // an expense that used no cash
      'Accounts Payable': '300.0000',          // an expense not yet paid
    });
    expect(r.operating_total).toBe('1000.0000');
    expect(r.investing.map(l => [l.account_name, l.amount])).toEqual([['Equipment', '-2000.0000']]);
    expect(r.investing_total).toBe('-2000.0000');
    expect(r.financing.map(l => [l.account_name, l.amount])).toEqual([['Notes Payable', '4000.0000']]);
    expect(r.financing_total).toBe('4000.0000');

    expect(r.cash_beginning).toBe('5000.0000');
    expect(r.net_change_in_cash).toBe('3000.0000');
    expect(r.cash_ending).toBe('8000.0000');
    // The three sections account for the whole change in cash.
    expect(Number(r.operating_total) + Number(r.investing_total) + Number(r.financing_total)).toBe(Number(r.net_change_in_cash));
  });

  it('places accounts by detail type, and by name when there is none', () => {
    const at = (account_type: string, name: string, detail_type: string | null = null, banking = false) =>
      rpt.cashFlowSection({ account_type, name, detail_type }, banking);
    expect(at('asset', 'Any name', 'Checking')).toBe('cash');
    expect(at('asset', 'Business Credit Card Clearing', null, true)).toBe('cash');   // set up under Banking
    expect(at('asset', 'Cash on Hand')).toBe('cash');
    expect(at('asset', 'Undeposited Funds')).toBe('operating');
    expect(at('asset', 'Inventory', 'Inventory')).toBe('operating');
    expect(at('asset', 'Trucks', 'Vehicles')).toBe('investing');
    expect(at('asset', 'Equipment')).toBe('investing');
    expect(at('asset', 'Accumulated Depreciation', 'Accumulated Depreciation')).toBe('operating');
    expect(at('liability', 'Amex', 'Credit Card')).toBe('operating');
    expect(at('liability', 'Truck loan', 'Notes Payable')).toBe('financing');
    expect(at('liability', 'SBA Loan')).toBe('financing');
    expect(at('equity', 'Owner Draws')).toBe('financing');
    expect(at('expense', 'Rent')).toBe('income');
  });
});
