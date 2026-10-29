import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { grantAccess, makeBusiness, makeFirm, makeUser, seedCoa, seedYearPeriods } from '../helpers/factories.js';
import { makeApp } from '../../src/app.js';
import { destroyDbSingleton } from '../../src/db/index.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';
import { computeTrialBalance } from '../../src/services/core/ledgerService.js';
import { importCheck, runQbImport, undoBatch, type QbImportResult } from '../../src/services/import/qbBatches.js';
import { importAccounts, importCustomers, importItems, importVendors } from '../../src/services/import/qbLists.js';
import { importOpenBills, importOpenInvoices } from '../../src/services/import/qbOpenItems.js';
import { importHistory, importTrialBalance, importUncleared } from '../../src/services/import/qbLedger.js';

const meta = { request_id: '00000000-0000-0000-0000-000000002028', ip_address: '127.0.0.1', user_agent: 'vitest' };
const CUTOVER = '2026-10-31';

// Moving a client from QuickBooks (docs/specs/2026-10-28-quickbooks-import-design.md):
// the lists, open invoices and bills, uncleared bank items, history, and the
// opening entry that brings every account to QuickBooks' trial balance.
describe('QuickBooks import', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await startTestDb();
    process.env.DATABASE_URL = t.url;
  });
  afterAll(async () => {
    await destroyDbSingleton();
    await stopTestDb();
  });
  beforeEach(async () => { await truncateAll(t.db); });

  async function setup() {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    await seedCoa(t.db, biz.id);
    await seedYearPeriods(t.db, biz.id, 2026);
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    const run = <T>(fn: (trx: Parameters<Parameters<typeof runQbImport>[1]>[0], ctx: ServiceCtx, input: T) => Promise<QbImportResult>, input: T, dryRun = false) =>
      runQbImport(t.db, trx => fn(trx, ctx, input), dryRun);
    const account = (name: string) => t.db.selectFrom('chart_of_accounts').selectAll()
      .where('business_id', '=', biz.id).where('name', '=', name).executeTakeFirstOrThrow();
    return { firm, biz, user, ctx, run, account };
  }

  const ACCOUNTS = [
    { name: 'Business Checking', number: '1000', account_type: 'asset' as const, detail_type: 'Checking' },
    { name: 'Accounts receivable (A/R)', number: '1100', account_type: 'asset' as const, detail_type: 'Accounts receivable (A/R)' },
    { name: 'Accounts Payable (A/P)', account_type: 'liability' as const, detail_type: 'Accounts payable (A/P)' },
    { name: 'Utilities', account_type: 'expense' as const, detail_type: 'Utilities' },
    { name: 'Utilities:Gas', account_type: 'expense' as const },
    { name: 'Consulting Income', number: '4010', account_type: 'revenue' as const },
    { name: 'Visa', account_type: 'liability' as const, detail_type: 'Credit Card' },
    { name: 'Retained Earnings', account_type: 'equity' as const, detail_type: 'Retained Earnings' },
  ];

  it('maps QuickBooks accounts onto this company\'s own, keeps sub-accounts, and refuses a type clash', async () => {
    const s = await setup();
    const r = await s.run(importAccounts, { cutover_date: CUTOVER, rows: ACCOUNTS });
    expect(r.problems).toEqual([]);
    expect(r.counts).toEqual({ created: 4, already_here: 4 });
    // The app's own A/R and A/P take QuickBooks' names, so later uploads find them.
    const ar = await s.account('Accounts receivable (A/R)');
    expect(ar.system_key).toBe('accounts_receivable');
    expect(ar.code).toBe('1100');
    expect((await s.account('Accounts Payable (A/P)')).system_key).toBe('accounts_payable');
    const gas = await s.account('Gas');
    expect(gas.parent_id).toBe((await s.account('Utilities')).id);
    expect(gas.code).toBe('6010');
    // 4010 is Sales Revenue here, so Consulting Income gets the next free number.
    expect((await s.account('Consulting Income')).code).toBe('4030');
    expect(r.notes.some(n => n.includes('number 4010 is taken by Sales Revenue'))).toBe(true);

    const clash = await s.run(importAccounts, { cutover_date: CUTOVER, rows: [{ name: 'Rent', account_type: 'revenue' as const }] });
    expect(clash.problems[0]!.message).toContain('already here as an expense account');
    expect(clash.batch_id).toBeNull();

    // Undone, the new accounts go and the renamed ones get their names back.
    await t.db.transaction().execute(trx => undoBatch(trx, s.ctx, r.batch_id!));
    expect((await t.db.selectFrom('chart_of_accounts').select('code').where('id', '=', ar.id).executeTakeFirstOrThrow()).code).toBe('1100');
    expect((await s.account('Accounts Receivable')).id).toBe(ar.id);
    expect(await t.db.selectFrom('chart_of_accounts').select('id').where('name', '=', 'Visa').executeTakeFirst()).toBeUndefined();
  });

  it('moves a client: lists, open items, uncleared items, then an opening entry that ties to QuickBooks', async () => {
    const s = await setup();
    expect((await s.run(importAccounts, { cutover_date: CUTOVER, rows: ACCOUNTS })).problems).toEqual([]);
    const customers = await s.run(importCustomers, {
      cutover_date: CUTOVER,
      rows: [
        { name: 'Acme Corp', email: 'ap@acme.test', billing_address: { line1: '1 Main St', city: 'Austin' }, terms_days: 30 },
        { name: 'Beta LLC' },
        { name: 'acme corp' },
      ],
    });
    expect(customers.counts).toEqual({ created: 2, already_here: 1 });
    await s.run(importVendors, { cutover_date: CUTOVER, rows: [{ name: 'Power Co' }, { name: 'Paper Supply' }] });
    const items = await s.run(importItems, {
      cutover_date: CUTOVER,
      rows: [
        { name: 'Consulting', income_account: 'Consulting Income', sale_price: '150' },
        { name: 'Widget', sku: 'W-1', income_account: 'Sales Revenue', expense_account: 'Cost of Goods Sold', inventory_asset_account: 'Inventory', purchase_cost: '5', quantity_on_hand: '10' },
      ],
    });
    expect(items.problems).toEqual([]);
    expect(items.counts).toEqual({ created: 2, with_stock: 1, already_here: 0 });

    const invoices = await s.run(importOpenInvoices, {
      cutover_date: CUTOVER,
      rows: [
        { customer: 'Acme Corp', type: 'Invoice', date: '2026-10-05', number: '1047', due_date: '2026-11-04', amount: '500.00' },
        { customer: 'Beta LLC', type: 'Invoice', date: '2026-09-20', number: '1040', amount: '250.00' },
        { customer: 'Acme Corp', type: 'Credit Memo', date: '2026-10-10', number: 'CM9', amount: '-50.00' },
      ],
    });
    expect(invoices.problems).toEqual([]);
    expect(invoices.preview).toEqual({ invoice_total: '750.0000', credit_total: '50.0000', net: '700.0000' });
    const inv = await t.db.selectFrom('invoices').selectAll().where('invoice_number', '=', '1047').executeTakeFirstOrThrow();
    expect(inv.status).toBe('posted');
    expect(String(inv.due_date).slice(0, 10)).toBe('2026-11-04');

    const bills = await s.run(importOpenBills, {
      cutover_date: CUTOVER,
      rows: [
        { vendor: 'Power Co', type: 'Bill', date: '2026-10-15', number: '88', amount: '120.00' },
        { vendor: 'Paper Supply', type: 'Bill', date: '2026-10-20', number: '88', amount: '80.00' },
      ],
    });
    expect(bills.problems).toEqual([]);
    expect((await t.db.selectFrom('bills').select('bill_number').orderBy('bill_number').execute()).map(b => b.bill_number)).toEqual(['88', '88-2']);

    const uncleared = await s.run(importUncleared, {
      cutover_date: CUTOVER, account: '1000 Business Checking',
      rows: [
        { date: '2026-10-29', type: 'Check', number: '1201', name: 'Power Co', amount: '-300.00' },
        { date: '2026-10-30', type: 'Deposit', amount: '150.00' },
      ],
    });
    expect(uncleared.problems).toEqual([]);

    const trialBalance = {
      cutover_date: CUTOVER,
      lines: [
        { account: '1000 Business Checking', debit: '10000.00', credit: '0' },
        { account: 'Accounts receivable (A/R)', debit: '700.00', credit: '0' },
        { account: 'Inventory', debit: '50.00', credit: '0' },
        { account: 'Visa', debit: '0', credit: '400.00' },
        { account: 'Accounts Payable (A/P)', debit: '0', credit: '200.00' },
        { account: 'Retained Earnings', debit: '0', credit: '6000.00' },
        { account: 'Consulting Income', debit: '0', credit: '9000.00' },
        { account: 'Utilities:Gas', debit: '1200.00', credit: '0' },
        { account: 'Rent', debit: '3650.00', credit: '0' },
      ],
    };
    const preview = await s.run(importTrialBalance, trialBalance, true);
    expect(preview.problems).toEqual([]);
    expect(preview.batch_id).toBeNull();
    const line = (name: string) => (preview.preview as { lines: { name: string; entry: string; here: string }[] }).lines.find(l => l.name === name)!;
    // The bank opens at its cleared balance: the uncleared items are already here.
    expect(line('Business Checking')).toMatchObject({ here: '-150.0000', entry: '10150.0000' });
    expect(line('Accounts receivable (A/R)').entry).toBe('0.0000');
    expect(line('Accounts Payable (A/P)').entry).toBe('0.0000');
    expect(line('Inventory').entry).toBe('0.0000');
    expect(line('Opening Balance Equity')).toMatchObject({ here: '-400.0000', entry: '400.0000' });
    expect(await t.db.selectFrom('qb_import_batches').select('id').where('step', '=', 'trial_balance').executeTakeFirst()).toBeUndefined();

    const posted = await s.run(importTrialBalance, trialBalance);
    expect(posted.problems).toEqual([]);
    expect(posted.notes.some(n => n.includes('Business Checking is reconciled to 2026-10-31 at 10150.0000, with 2 uncleared items left'))).toBe(true);

    const check = await importCheck(t.db, s.biz.id);
    expect(check.differences).toBe(0);
    const tb = await computeTrialBalance(t.db, { business_id: s.biz.id, as_of: CUTOVER });
    const obe = await s.account('Opening Balance Equity');
    expect(tb.rows.find(r => r.account_id === obe.id)?.net ?? '0.0000').toBe('0.0000');

    // The uncleared items are the only ones left to tick on the bank.
    const bank = await s.account('Business Checking');
    const recon = await t.db.selectFrom('reconciliations').selectAll().where('account_id', '=', bank.id).executeTakeFirstOrThrow();
    expect(recon.status).toBe('completed');
    expect(String(recon.statement_ending_balance)).toBe('10150.0000');
    const unticked = await t.db.selectFrom('journal_entries as j').innerJoin('journal_entry_lines as l', 'l.journal_entry_id', 'j.id')
      .select('j.reference').where('l.account_id', '=', bank.id).where('j.reconciliation_status', '!=', 'reconciled').execute();
    expect(unticked.map(u => u.reference).sort()).toEqual(['1201', null].sort());

    // Nothing goes under the opening entry, until it is undone.
    const late = await s.run(importOpenInvoices, {
      cutover_date: CUTOVER, rows: [{ customer: 'Beta LLC', type: 'Invoice', date: '2026-10-01', number: '1041', amount: '10' }],
    });
    expect(late.problems[0]!.message).toContain('opening balances are already posted');
    await t.db.transaction().execute(trx => undoBatch(trx, s.ctx, posted.batch_id!));
    expect(await t.db.selectFrom('reconciliations').select('id').where('account_id', '=', bank.id).executeTakeFirst()).toBeUndefined();
    expect((await s.run(importOpenInvoices, {
      cutover_date: CUTOVER, rows: [{ customer: 'Beta LLC', type: 'Invoice', date: '2026-10-01', number: '1041', amount: '10' }],
    }, true)).problems).toEqual([]);

    // A customer with open invoices here can't be taken out by undoing the customer upload.
    await expect(t.db.transaction().execute(trx => undoBatch(trx, s.ctx, customers.batch_id!))).rejects.toThrow(/has transactions now/);
    await t.db.transaction().execute(trx => undoBatch(trx, s.ctx, invoices.batch_id!));
    expect((await t.db.selectFrom('invoices').select('status').where('invoice_number', '=', '1047').executeTakeFirstOrThrow()).status).toBe('voided');
  });

  it('brings history in as journal entries, and then needs no opening entry', async () => {
    const s = await setup();
    await s.run(importAccounts, { cutover_date: CUTOVER, rows: [ACCOUNTS[0]!, ACCOUNTS[5]!] });
    const bad = await s.run(importHistory, {
      cutover_date: CUTOVER,
      transactions: [
        { date: '2026-03-01', type: 'Journal Entry', number: '7', lines: [{ account: 'Rent', debit: '10', credit: '0' }, { account: 'Business Checking', debit: '0', credit: '9' }] },
        { date: '2025-12-15', type: 'Deposit', lines: [{ account: 'Business Checking', debit: '5', credit: '0' }, { account: 'Consulting Income', debit: '0', credit: '5' }] },
        { date: '2026-03-02', type: 'Check', lines: [{ account: 'Nowhere', debit: '5', credit: '0' }, { account: 'Business Checking', debit: '0', credit: '5' }] },
      ],
    });
    expect(bad.problems.map(p => p.message)).toEqual([
      'No account named "Nowhere". Bring it in with the chart of accounts, or add it on Chart of Accounts',
      "Journal Entry 7 of 2026-03-01 doesn't balance: debits 10.0000, credits 9.0000",
      "Some rows are dated in 2025, which has no fiscal periods here. Set up 2025's periods first",
    ]);

    const history = await s.run(importHistory, {
      cutover_date: CUTOVER,
      transactions: [
        { date: '2026-01-15', type: 'Deposit', name: 'Acme Corp', lines: [{ account: 'Business Checking', debit: '1000', credit: '0' }, { account: 'Consulting Income', debit: '0', credit: '1000' }] },
        { date: '2026-02-01', type: 'Check', number: '101', name: 'Landlord', lines: [{ account: 'Rent', debit: '400', credit: '0' }, { account: 'Business Checking', debit: '0', credit: '400' }] },
      ],
    });
    expect(history.problems).toEqual([]);
    expect(history.counts).toEqual({ transactions: 2 });
    const check = await t.db.selectFrom('journal_entries').selectAll().where('reference', '=', '101').executeTakeFirstOrThrow();
    expect(check).toMatchObject({ transaction_type: 'check', payee_name: 'Landlord', memo: 'Check', status: 'posted' });

    const opening = await s.run(importTrialBalance, {
      cutover_date: CUTOVER,
      lines: [
        { account: 'Business Checking', debit: '600', credit: '0' },
        { account: 'Consulting Income', debit: '0', credit: '1000' },
        { account: 'Rent', debit: '400', credit: '0' },
      ],
    });
    expect(opening.problems).toEqual([]);
    expect(opening.counts).toEqual({ entry_lines: 0, reconciled_accounts: 1 });
    expect(opening.notes).toContain('Every account already matches QuickBooks, so no opening entry was needed');
    expect(await t.db.selectFrom('journal_entries').select('reconciliation_status').where('reference', '=', '101').executeTakeFirstOrThrow())
      .toEqual({ reconciliation_status: 'reconciled' });

    // Undoing the opening balances, then the history, voids every entry.
    await t.db.transaction().execute(trx => undoBatch(trx, s.ctx, opening.batch_id!));
    await t.db.transaction().execute(trx => undoBatch(trx, s.ctx, history.batch_id!));
    const tb = await computeTrialBalance(t.db, { business_id: s.biz.id, as_of: CUTOVER });
    expect(tb.rows.every(r => r.net === '0.0000')).toBe(true);
  });

  it('over HTTP: a dry run saves nothing, staff are refused, and an upload with a problem posts nothing', async () => {
    const s = await setup();
    const staff = await makeUser(t.db, s.firm.id, { role: 'staff' });
    await grantAccess(t.db, staff.id, s.biz.id);
    await grantAccess(t.db, s.user.id, s.biz.id);
    const app = makeApp();
    const login = async (u: { email: string; plaintext_password: string }) => {
      const res = await request(app).post('/auth/login').send({ email: u.email, password: u.plaintext_password });
      return { Authorization: `Bearer ${res.body.access_token as string}` };
    };
    const accountant = await login(s.user);
    const base = `/businesses/${s.biz.id}/qb-import`;
    const body = { cutover_date: CUTOVER, rows: [{ name: 'Acme Corp' }] };

    const dry = await request(app).post(`${base}/customers?dry_run=true`).set(accountant).send(body);
    expect(dry.status).toBe(200);
    expect(dry.body).toMatchObject({ dry_run: true, batch_id: null, counts: { created: 1 } });
    expect(await t.db.selectFrom('customers').select('id').executeTakeFirst()).toBeUndefined();

    expect((await request(app).post(`${base}/customers`).set(await login(staff)).send(body)).status).toBe(403);

    const refused = await request(app).post(`${base}/open-invoices`).set(accountant)
      .send({ cutover_date: CUTOVER, rows: [{ customer: 'Nobody', type: 'Invoice', date: '2026-10-01', amount: '5' }] });
    expect(refused.status).toBe(422);
    expect(refused.body.problems[0].message).toContain('No customer named "Nobody"');

    const saved = await request(app).post(`${base}/customers`).set(accountant).send(body);
    expect(saved.status).toBe(200);
    expect(saved.body.batch_id).toEqual(expect.any(String));
    const list = await request(app).get(base).set(accountant);
    expect(list.body).toMatchObject({ cutover_date: CUTOVER, batches: [{ step: 'customers', record_count: 1 }] });
    expect((await request(app).post(`${base}/customers`).set(accountant).send({ ...body, cutover_date: '2026-09-30' })).body.problems[0].message)
      .toContain('uses the cutover date 2026-10-31');

    const undo = await request(app).post(`${base}/batches/${saved.body.batch_id as string}/undo`).set(accountant).send({});
    expect(undo.status).toBe(200);
    expect(await t.db.selectFrom('customers').select('id').where('deleted_at', 'is', null).executeTakeFirst()).toBeUndefined();
  });
});
