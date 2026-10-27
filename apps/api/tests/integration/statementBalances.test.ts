// Item 72 (10-16 follow-ups): a statement's own period and balances, read by
// the AI, corrected on review, and kept with the account it was approved
// against, for Reconcile to fill its ending balance and date from.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, grantAccess, makeAccount, makeBankAccount, seedYearPeriods } from '../helpers/factories.js';
import { makeApp } from '../../src/app.js';
import { destroyDbSingleton } from '../../src/db/index.js';
import { readStatementSummary, splitByAccount } from '../../src/services/ai/statementImportService.js';

const PASSWORD = 'pw12345678';

describe('statement balances', () => {
  let t: TestDb;
  let app: Express;
  let bizId: string;
  let checkingId: string;
  let suppliesId: string;
  let token: string;

  beforeAll(async () => {
    t = await startTestDb();
    process.env.DATABASE_URL = t.url;
    app = makeApp();
  });
  afterAll(async () => {
    await destroyDbSingleton();
    await stopTestDb();
  });
  beforeEach(async () => {
    await truncateAll(t.db);
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id, 'Statement Balances Co');
    bizId = biz.id;
    await seedYearPeriods(t.db, biz.id, 2026);
    checkingId = (await makeAccount(t.db, biz.id, { code: '1010', name: 'Operating Checking', account_type: 'asset', detail_type: 'Checking' })).id;
    await makeBankAccount(t.db, biz.id, checkingId, { name: 'Operating Checking', institution: 'Wells Fargo' });
    suppliesId = (await makeAccount(t.db, biz.id, { code: '6010', name: 'Office Supplies', account_type: 'expense' })).id;
    const user = await makeUser(t.db, firm.id, { email: 'acct@x.com', password: PASSWORD, role: 'accountant' });
    await grantAccess(t.db, user.id, biz.id);
    const res = await request(app).post('/auth/login').send({ email: 'acct@x.com', password: PASSWORD });
    token = res.body.access_token as string;
  });

  const get = (url: string) => request(app).get(`/businesses/${bizId}${url}`).set('Authorization', `Bearer ${token}`);
  const post = (url: string, body: object) => request(app).post(`/businesses/${bizId}${url}`).set('Authorization', `Bearer ${token}`).send(body);

  async function stageMarchStatement() {
    const row = await t.db.insertInto('email_import_staging').values({
      business_id: bizId,
      source: 'upload',
      email_subject: 'march.pdf',
      received_at: '2026-04-02T12:00:00.000Z',
      status: 'pending',
      statement_kind: 'bank',
      account_hint: 'Business Checking 2553',
      extracted_transactions: JSON.stringify([
        { date: '03/05/2026', description: 'DEPOSIT', amount: '1000.00', type: 'deposit' },
        { date: '03/12/2026', description: 'STAPLES', amount: '49.99', type: 'expense' },
      ]),
      period_start: '2026-03-01',
      period_end: '2026-03-31',
      beginning_balance: '5000.00',
      // Misread by the AI: the PDF says 5,950.01.
      ending_balance: '5590.01',
    }).returning('id').executeTakeFirstOrThrow();
    return row.id;
  }

  it('reads each account\'s period and balances out of what the model returned', () => {
    expect(readStatementSummary({
      period_start: '03/01/2026', period_end: '3/31/2026', beginning_balance: '$5,000.00', ending_balance: '(12.50)',
    })).toEqual({ period_start: '2026-03-01', period_end: '2026-03-31', beginning_balance: '5000.00', ending_balance: '-12.50' });
    // Misread dates and amounts are left empty rather than guessed.
    expect(readStatementSummary({ period_start: '04/01/2026', period_end: '02/30/2026', ending_balance: 'see page 2' }))
      .toEqual({ period_start: '2026-04-01', period_end: null, beginning_balance: null, ending_balance: null });
    expect(readStatementSummary({ period_start: '04/01/2026', period_end: '03/31/2026' }).period_start).toBeNull();

    const accounts = [
      { name: 'Checking', last4: '2553', period_end: '03/31/2026', ending_balance: '5950.01' },
      { name: 'Savings', last4: '8344', period_end: '03/31/2026', ending_balance: '20000.00' },
    ];
    const parts = splitByAccount([
      { description: 'A', account_last4: '2553' },
      { description: 'B', account_last4: '8344' },
    ], accounts);
    expect(parts.map(p => [p.account_hint, p.summary.ending_balance])).toEqual([
      ['Checking 2553', '5950.01'],
      ['Savings 8344', '20000.00'],
    ]);
  });

  it('keeps the corrected balances and the account on approval, for Reconcile', async () => {
    const importId = await stageMarchStatement();

    const pending = await get('/email-imports');
    expect(pending.status).toBe(200);
    expect(pending.body.imports[0]).toMatchObject({
      period_start: '2026-03-01', period_end: '2026-03-31', beginning_balance: '5000.0000', ending_balance: '5590.0100', account_id: null,
    });

    const approved = await post(`/email-imports/${importId}/approve`, {
      bank_account_id: checkingId,
      transactions: [
        { index: 0, offset_account_id: suppliesId, include: false },
        { index: 1, offset_account_id: suppliesId },
      ],
      summary: { period_start: '2026-03-01', period_end: '2026-03-31', beginning_balance: '5000.00', ending_balance: '5950.01' },
    });
    expect(approved.status).toBe(200);

    const row = await t.db.selectFrom('email_import_staging')
      .select(['status', 'account_id', 'period_end', 'ending_balance'])
      .where('id', '=', importId).executeTakeFirstOrThrow();
    expect(row).toEqual({ status: 'approved', account_id: checkingId, period_end: '2026-03-31', ending_balance: '5950.0100' });

    const balances = await get(`/email-imports/statement-balances?account_id=${checkingId}`);
    expect(balances.status).toBe(200);
    expect(balances.body.statements).toHaveLength(1);
    expect(balances.body.statements[0]).toMatchObject({
      id: importId, period_end: '2026-03-31', beginning_balance: '5000.0000', ending_balance: '5950.0100',
    });
    // Another account has no statements.
    expect((await get(`/email-imports/statement-balances?account_id=${suppliesId}`)).body.statements).toEqual([]);
  });

  it('GET /email-imports/:importId returns one staged statement in full, without shadowing the literal routes beside it', async () => {
    const importId = await stageMarchStatement();

    // The literal-segment routes registered around the new :importId route
    // still resolve to themselves, not get swallowed by its wildcard.
    expect((await get('/email-imports/pending-count')).status).toBe(200);
    expect((await get(`/email-imports/statement-balances?account_id=${checkingId}`)).status).toBe(200);

    const single = await get(`/email-imports/${importId}`);
    expect(single.status).toBe(200);
    expect(single.body.import).toMatchObject({
      id: importId, statement_kind: 'bank', account_hint: 'Business Checking 2553',
      period_start: '2026-03-01', period_end: '2026-03-31',
      beginning_balance: '5000.0000', ending_balance: '5590.0100',
    });
    expect(single.body.import.extracted_transactions).toHaveLength(2);
    expect(single.body.import.extracted_transactions[0]).toMatchObject({ description: 'DEPOSIT', amount: '1000.00' });

    expect((await get('/email-imports/00000000-0000-0000-0000-000000000000')).status).toBe(404);
  });

  it('refuses a period that ends before it starts, and an amount that is not one', async () => {
    const importId = await stageMarchStatement();
    const body = (summary: object) => ({
      bank_account_id: checkingId,
      transactions: [{ index: 0, offset_account_id: suppliesId }],
      summary: { period_start: '2026-03-01', period_end: '2026-03-31', beginning_balance: null, ending_balance: null, ...summary },
    });
    expect((await post(`/email-imports/${importId}/approve`, body({ period_end: '2026-02-28' }))).status).toBe(400);
    expect((await post(`/email-imports/${importId}/approve`, body({ ending_balance: '5,950.01' }))).status).toBe(400);
    expect((await get('/email-imports/statement-balances?account_id=nope')).status).toBe(400);
    const row = await t.db.selectFrom('email_import_staging').select('status').where('id', '=', importId).executeTakeFirstOrThrow();
    expect(row.status).toBe('pending');
  });
});
