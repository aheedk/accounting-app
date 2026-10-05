import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeAccount, makeBankAccount, makeBusiness, makeFirm, makeUser, seedYearPeriods } from '../helpers/factories.js';
import {
  cardPaymentSourceAccount,
  checkNumberOf,
  findAlreadyRecorded,
  guessCardAccount,
  normalizeCardLines,
  postStatementLines,
  splitByAccount,
  type StatementLine,
} from '../../src/services/ai/statementImportService.js';
import { pickCreditCard } from '../../src/services/ai/autoCodingService.js';
import { describeTransactions } from '../../src/services/core/transactionDescriptorService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

async function setup(t: TestDb) {
  const firm = await makeFirm(t.db);
  const business = await makeBusiness(t.db, firm.id, 'Card Import Biz');
  const user = await makeUser(t.db, firm.id, { role: 'accountant' });
  const ctx: ServiceCtx = {
    user_id: user.id, firm_id: firm.id, business_id: business.id, effective_role: 'accountant',
    request_id: '00000000-0000-0000-0000-00000000ab15', ip_address: '127.0.0.1', user_agent: 'vitest',
  };
  await seedYearPeriods(t.db, business.id, 2026);
  const checking = await makeAccount(t.db, business.id, { code: '1010', name: 'Operating Checking', account_type: 'asset', detail_type: 'Checking' });
  await makeBankAccount(t.db, business.id, checking.id, { name: 'Operating Checking', institution: 'Wells Fargo' });
  const card = await makeAccount(t.db, business.id, { code: '2100', name: 'Chase Ink 4421', account_type: 'liability', detail_type: 'Credit Card' });
  const supplies = await makeAccount(t.db, business.id, { code: '6010', name: 'Office Supplies', account_type: 'expense' });
  return { business, ctx, checking, card, supplies };
}

const cardStatement: StatementLine[] = normalizeCardLines([
  { date: '03/04/2026', payee_name: 'Staples', description: 'STAPLES #1123', amount: '89.99', type: 'charge' },
  { date: '03/09/2026', payee_name: 'Staples', description: 'STAPLES RETURN', amount: '20.00', type: 'refund' },
  { date: '03/15/2026', description: 'PAYMENT RECEIVED - THANK YOU', amount: '500.00', type: 'payment' },
]);

async function entryLines(t: TestDb, id: string) {
  const lines = await t.db.selectFrom('journal_entry_lines').select(['account_id', 'debit', 'credit'])
    .where('journal_entry_id', '=', id).orderBy('line_number').execute();
  return lines.map(l => [l.account_id, l.debit, l.credit]);
}

describe('statement import', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('reads card lines into the statement shape and finds check numbers', () => {
    expect(cardStatement.map(l => [l.type, l.card_type])).toEqual([
      ['expense', 'charge'], ['deposit', 'refund'], ['deposit', 'payment'],
    ]);
    expect(normalizeCardLines([{ date: '03/01/2026', description: 'X', amount: '-5' }])[0])
      .toMatchObject({ type: 'expense', card_type: 'charge', amount: '5' });
    expect(checkNumberOf({ description: 'CHECK 1042' })).toBe('1042');
    expect(checkNumberOf({ description: 'Chk #2001 cleared' })).toBe('2001');
    expect(checkNumberOf({ description: 'DUKE ENERGY' })).toBeNull();
    expect(checkNumberOf({ description: 'anything', check_number: '#77' })).toBe('77');
  });

  it('splits a file holding several accounts into one statement per account', () => {
    const accounts = [{ name: 'Business Checking', last4: '2553' }, { name: 'Savings', last4: '8344' }];
    const lines = [
      { description: 'A', account_last4: '2553' },
      { description: 'B', account_last4: '8344' },
      { description: 'C', account_last4: '2553' },
    ];
    expect(splitByAccount(lines, accounts)).toEqual([
      { account_hint: 'Business Checking 2553', lines: [lines[0], lines[2]] },
      { account_hint: 'Savings 8344', lines: [lines[1]] },
    ]);
    // One account: a single statement named after it, whether or not lines are tagged.
    expect(splitByAccount([{ description: 'A' }], [accounts[0]!])).toEqual([
      { account_hint: 'Business Checking 2553', lines: [{ description: 'A' }] },
    ]);
    expect(splitByAccount([{ description: 'A' }], undefined)).toEqual([{ account_hint: null, lines: [{ description: 'A' }] }]);
  });

  it('posts a card statement against the card: charge, refund and payment', async () => {
    const data = await setup(t);
    const ids = await t.db.transaction().execute(trx => postStatementLines(trx, data.ctx, {
      staging_id: randomUUID(),
      statement_kind: 'credit_card',
      lines: cardStatement,
      account_id: data.card.id,
      items: [
        { index: 0, offset_account_id: data.supplies.id, payee_name: 'Staples' },
        { index: 1, offset_account_id: data.supplies.id },
        { index: 2, offset_account_id: data.checking.id },
      ],
    }));
    const [charge, refund, payment] = ids as string[];

    expect(await entryLines(t, charge!)).toEqual([[data.card.id, '0.0000', '89.9900'], [data.supplies.id, '89.9900', '0.0000']]);
    expect(await entryLines(t, refund!)).toEqual([[data.card.id, '20.0000', '0.0000'], [data.supplies.id, '0.0000', '20.0000']]);
    expect(await entryLines(t, payment!)).toEqual([[data.card.id, '500.0000', '0.0000'], [data.checking.id, '0.0000', '500.0000']]);

    // The charge became an Expense paid by credit card; refund and payment stay imported entries.
    const expense = await t.db.selectFrom('expense_transactions').selectAll()
      .where('journal_entry_id', '=', charge!).executeTakeFirstOrThrow();
    expect(expense).toMatchObject({ payment_method: 'credit_card', payment_account_id: data.card.id });

    const entries = await t.db.selectFrom('journal_entries')
      .select(['id', 'source_type', 'source_id', 'transaction_type', 'payee_name', 'reference', 'journal_number'])
      .where('id', 'in', ids as string[]).execute();
    const labels = await describeTransactions(t.db, entries.map(e => ({ ...e, transaction_type: e.transaction_type ?? null, payee_name: e.payee_name ?? null })));
    expect([charge, refund, payment].map(id => labels.get(id!)?.label))
      .toEqual(['Credit Card Expense', 'Credit Card Credit', 'Credit Card Payment']);
    expect(labels.get(payment!)?.path).toBe(`/transactions/${payment}`);
  });

  it('refuses a card statement on a bank account, and a line coded to the statement account', async () => {
    const data = await setup(t);
    await expect(t.db.transaction().execute(trx => postStatementLines(trx, data.ctx, {
      staging_id: randomUUID(), statement_kind: 'credit_card', lines: cardStatement,
      account_id: data.checking.id, items: [{ index: 0, offset_account_id: data.supplies.id }],
    }))).rejects.toThrow(/credit card \(liability\) account/);
    await expect(t.db.transaction().execute(trx => postStatementLines(trx, data.ctx, {
      staging_id: randomUUID(), statement_kind: 'credit_card', lines: cardStatement,
      account_id: data.card.id, items: [{ index: 2, offset_account_id: data.card.id }],
    }))).rejects.toThrow(/own account/);
  });

  it('spots a card payment already posted from the bank statement', async () => {
    const data = await setup(t);
    const bankStatement: StatementLine[] = [
      { date: '03/14/2026', description: 'CHASE CREDIT CRD AUTOPAY', amount: '500.00', type: 'expense' },
    ];
    const [fromBank] = await t.db.transaction().execute(trx => postStatementLines(trx, data.ctx, {
      staging_id: randomUUID(), statement_kind: 'bank', lines: bankStatement,
      account_id: data.checking.id, items: [{ index: 0, offset_account_id: data.card.id }],
    }));

    const cardStagingId = randomUUID();
    const matches = await findAlreadyRecorded(t.db, data.ctx, {
      staging_id: cardStagingId,
      account_id: data.card.id,
      lines: cardStatement,
      offsets: [
        { index: 0, offset_account_id: data.supplies.id },   // a category line: never checked
        { index: 2, offset_account_id: data.checking.id },
      ],
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ index: 2, journal_entry_id: fromBank, label: 'Expense' });

    // A different amount, or the same statement's own entries, do not count.
    const otherAmount = await findAlreadyRecorded(t.db, data.ctx, {
      staging_id: cardStagingId, account_id: data.card.id,
      lines: [{ ...cardStatement[2]!, amount: '499.00' }],
      offsets: [{ index: 0, offset_account_id: data.checking.id }],
    });
    expect(otherAmount).toEqual([]);
  });

  it('suggests where a card payment came from, which card a statement is, and which card a bank payment paid', async () => {
    const data = await setup(t);
    expect(await cardPaymentSourceAccount(t.db, data.business.id, 'PAYMENT RECEIVED'))
      .toEqual({ account_id: data.checking.id, confident: true });

    const amex = await makeAccount(t.db, data.business.id, { code: '2110', name: 'Amex Business Gold', account_type: 'liability', detail_type: 'Credit Card' });
    expect(await guessCardAccount(t.db, data.business.id, 'Chase Ink Business Cash 4421')).toBe(data.card.id);
    expect(await guessCardAccount(t.db, data.business.id, 'American Express Gold 9001')).toBe(amex.id);
    expect(await guessCardAccount(t.db, data.business.id, 'Amex Business Gold')).toBe(amex.id);
    expect(await guessCardAccount(t.db, data.business.id, null)).toBe(null);

    const accounts = await t.db.selectFrom('chart_of_accounts').select(['id', 'code', 'name', 'account_type', 'detail_type'])
      .where('business_id', '=', data.business.id).execute();
    expect(pickCreditCard(accounts, 'AMEX EPAYMENT ACH PMT')?.id).toBe(amex.id);
    expect(pickCreditCard(accounts, 'CHASE CREDIT CRD AUTOPAY')?.id).toBe(data.card.id);
    expect(pickCreditCard(accounts, 'CREDIT CARD PAYMENT')).toBeNull();
  });
});
