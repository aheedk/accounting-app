import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import {
  makeFirm, makeBusiness, makeUser, makeAccount, makeBankAccount, makeVendor, seedYearPeriods,
} from '../helpers/factories.js';
import * as autoCoding from '../../src/services/ai/autoCodingService.js';
import * as ledger from '../../src/services/core/ledgerService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = {
  request_id: '00000000-0000-0000-0000-0000000000ac',
  ip_address: '127.0.0.1',
  user_agent: 'vitest',
};

async function setup(t: TestDb) {
  const firm = await makeFirm(t.db);
  const biz = await makeBusiness(t.db, firm.id, 'Coding Biz');
  const user = await makeUser(t.db, firm.id, { role: 'accountant' });
  const ctx: ServiceCtx = {
    user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta,
  };
  await seedYearPeriods(t.db, biz.id, 2026);

  const cash = await makeAccount(t.db, biz.id, {
    code: '1010', name: 'Checking', account_type: 'asset', detail_type: 'Checking',
  });
  const savings = await makeAccount(t.db, biz.id, {
    code: '1020', name: 'Savings', account_type: 'asset', detail_type: 'Savings',
  });
  const utilities = await makeAccount(t.db, biz.id, {
    code: '6200', name: 'Utilities', account_type: 'expense', detail_type: 'Utilities',
  });
  const software = await makeAccount(t.db, biz.id, {
    code: '6300', name: 'Software & Subscriptions', account_type: 'expense',
  });
  const creditCard = await makeAccount(t.db, biz.id, {
    code: '2100', name: 'Chase Credit Card', account_type: 'liability', detail_type: 'Credit Card',
  });
  const payrollClearing = await makeAccount(t.db, biz.id, {
    code: '2200', name: 'Payroll Clearing', account_type: 'liability', detail_type: 'Payroll Clearing',
  });
  const bank = await makeBankAccount(t.db, biz.id, cash.id, { name: 'Operating Checking' });

  return { firm, biz, user, ctx, cash, savings, utilities, software, creditCard, payrollClearing, bank };
}

function input(overrides: Partial<autoCoding.CodingInput> & { bank_account_id: string }): autoCoding.CodingInput {
  return {
    description: 'GENERIC VENDOR',
    amount: '100.0000',
    direction: 'debit',
    ...overrides,
  };
}

describe('autoCodingService.detectTransactionType', () => {
  it('classifies the accounting-treatment transaction types', () => {
    expect(autoCoding.detectTransactionType('CHASE CARD PAYMENT')).toBe('credit_card_payment');
    expect(autoCoding.detectTransactionType('ADP PAYROLL FEES')).toBe('payroll');
    expect(autoCoding.detectTransactionType('SBA LOAN PAYMENT 12000')).toBe('loan_payment');
    expect(autoCoding.detectTransactionType('TRANSFER TO SAVINGS')).toBe('transfer');
    expect(autoCoding.detectTransactionType('DUKE ENERGY')).toBeNull();
  });
});

describe('autoCodingService.suggestCoding', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('returns null when no layer can classify the transaction', async () => {
    const { ctx, bank } = await setup(t);
    const result = await autoCoding.suggestCoding(t.db, ctx, input({
      description: 'SOMETHING ENTIRELY UNKNOWN LLC',
      bank_account_id: bank.id,
    }));
    expect(result).toBeNull();
  });

  it('prefers a learned client rule over every other layer', async () => {
    const { ctx, bank, utilities, software } = await setup(t);
    // History would say Utilities...
    await t.db.insertInto('account_coding_memory').values({
      business_id: ctx.business_id!,
      normalized_vendor: 'microsoft',
      direction: 'debit',
      bank_account_id: null,
      lines: JSON.stringify([
        { account_id: software.id, debit: '100.0000', credit: '0.0000', memo: null },
      ]),
    }).execute();

    const result = await autoCoding.suggestCoding(t.db, ctx, input({
      description: 'MICROSOFT*SUBSCRIPTION 8812',
      bank_account_id: bank.id,
      ai_suggested_account: 'Utilities',
    }));

    expect(result).toMatchObject({ source_layer: 'learned_rule', confidence: 99, band: 'auto_post' });
    expect(result!.lines[0]!.account_id).toBe(software.id);
    expect(result!.lines[0]!.account_id).not.toBe(utilities.id);
  });

  it('ignores a learned rule whose account was deactivated', async () => {
    const { ctx, bank, software } = await setup(t);
    await t.db.insertInto('account_coding_memory').values({
      business_id: ctx.business_id!,
      normalized_vendor: 'microsoft',
      direction: 'debit',
      bank_account_id: null,
      lines: JSON.stringify([
        { account_id: software.id, debit: '100.0000', credit: '0.0000', memo: null },
      ]),
    }).execute();
    await t.db.updateTable('chart_of_accounts')
      .set({ is_active: false }).where('id', '=', software.id).execute();

    const result = await autoCoding.suggestCoding(t.db, ctx, input({
      description: 'MICROSOFT*SUBSCRIPTION 8812',
      bank_account_id: bank.id,
    }));
    expect(result).toBeNull();
  });

  it('applies accounting rules ahead of the AI suggestion', async () => {
    const { ctx, bank, creditCard, payrollClearing, utilities } = await setup(t);

    const cardPayment = await autoCoding.suggestCoding(t.db, ctx, input({
      description: 'CHASE CARD PAYMENT',
      bank_account_id: bank.id,
      // The model wanted an expense account; the accounting rule must win.
      ai_suggested_account: 'Utilities',
    }));
    expect(cardPayment).toMatchObject({ source_layer: 'accounting_rule', band: 'preselected' });
    expect(cardPayment!.lines[0]!.account_id).toBe(creditCard.id);
    expect(cardPayment!.lines[0]!.account_id).not.toBe(utilities.id);

    const payroll = await autoCoding.suggestCoding(t.db, ctx, input({
      description: 'ADP PAYROLL 18450',
      bank_account_id: bank.id,
    }));
    expect(payroll!.source_layer).toBe('accounting_rule');
    expect(payroll!.lines[0]!.account_id).toBe(payrollClearing.id);
  });

  it('keeps loan payments below the auto-post threshold so a human splits them', async () => {
    const { ctx, bank } = await setup(t);
    await makeAccount(t.db, ctx.business_id!, {
      code: '2300', name: 'Loan Payable', account_type: 'liability', detail_type: 'Notes Payable',
    });

    const result = await autoCoding.suggestCoding(t.db, ctx, input({
      description: 'SBA LOAN PAYMENT',
      amount: '12000.0000',
      bank_account_id: bank.id,
    }));

    expect(result!.source_layer).toBe('accounting_rule');
    expect(result!.band).toBe('suggested');
    expect(result!.confidence).toBeLessThan(98);
  });

  it('uses the vendor default account when no rule or learned mapping applies', async () => {
    const { ctx, bank, software } = await setup(t);
    const vendor = await makeVendor(t.db, ctx.business_id!, { name: 'dropbox' });
    await t.db.updateTable('vendors')
      .set({ default_expense_account_id: software.id })
      .where('id', '=', vendor.id).execute();

    const result = await autoCoding.suggestCoding(t.db, ctx, input({
      description: 'DROPBOX',
      bank_account_id: bank.id,
    }));

    expect(result).toMatchObject({ source_layer: 'vendor_default', confidence: 90 });
    expect(result!.lines[0]!.account_id).toBe(software.id);
  });

  it('falls back to how the client coded the same vendor before', async () => {
    const { ctx, bank, cash, utilities } = await setup(t);
    // Post a JE and link a prior bank transaction to it.
    const je = await t.db.transaction().execute(trx => ledger.postJournalEntry(trx, ctx, {
      business_id: ctx.business_id!,
      entry_date: '2026-03-02',
      source_type: 'manual',
      memo: 'Prior Duke Energy bill',
      lines: [
        { account_id: utilities.id, debit: '624.0000', credit: '0.0000', memo: null },
        { account_id: cash.id, debit: '0.0000', credit: '624.0000', memo: null },
      ],
    }));
    await t.db.insertInto('bank_transactions').values({
      business_id: ctx.business_id!,
      bank_account_id: bank.id,
      transaction_date: '2026-03-02',
      description: 'POS DEBIT DUKE ENERGY 4456',
      amount: '-624.0000',
      matched_journal_entry_id: je.id,
      // bt_matched_has_je / bt_terminal_has_reviewer require these together.
      status: 'matched',
      reviewed_at: new Date().toISOString(),
      reviewed_by_user_id: ctx.user_id,
    }).execute();

    const result = await autoCoding.suggestCoding(t.db, ctx, input({
      description: 'DUKE ENERGY 7781',
      amount: '624.0000',
      bank_account_id: bank.id,
    }));

    expect(result).toMatchObject({ source_layer: 'history' });
    expect(result!.lines[0]!.account_id).toBe(utilities.id);
    // Unanimous history scores at the top of the history range.
    expect(result!.confidence).toBe(92);
  });

  it('accepts an AI suggestion only when it names a real account in this CoA', async () => {
    const { ctx, bank, software } = await setup(t);

    const good = await autoCoding.suggestCoding(t.db, ctx, input({
      description: 'NOVEL VENDOR XYZ',
      bank_account_id: bank.id,
      ai_suggested_account: 'Software & Subscriptions',
    }));
    expect(good).toMatchObject({ source_layer: 'ai', confidence: 85, band: 'suggested' });
    expect(good!.lines[0]!.account_id).toBe(software.id);

    // An account the model invented is discarded, not posted.
    const hallucinated = await autoCoding.suggestCoding(t.db, ctx, input({
      description: 'NOVEL VENDOR XYZ',
      bank_account_id: bank.id,
      ai_suggested_account: 'Imaginary Cloud Expenses',
    }));
    expect(hallucinated).toBeNull();
  });

  it('mirrors the bank direction onto the offsetting line', async () => {
    const { ctx, bank, software } = await setup(t);
    const vendor = await makeVendor(t.db, ctx.business_id!, { name: 'dropbox' });
    await t.db.updateTable('vendors')
      .set({ default_expense_account_id: software.id })
      .where('id', '=', vendor.id).execute();

    const debit = await autoCoding.suggestCoding(t.db, ctx, input({
      description: 'DROPBOX', amount: '50.0000', direction: 'debit', bank_account_id: bank.id,
    }));
    expect(debit!.lines[0]).toMatchObject({ debit: '50.0000', credit: '0.0000' });

    const credit = await autoCoding.suggestCoding(t.db, ctx, input({
      description: 'DROPBOX', amount: '50.0000', direction: 'credit', bank_account_id: bank.id,
    }));
    expect(credit!.lines[0]).toMatchObject({ debit: '0.0000', credit: '50.0000' });
  });
});

// Real charts of accounts frequently carry no detail_type at all (the seeded
// demo CoA has none), so the accounting rules have to work off account names.
describe('autoCodingService accounting rules without detail types', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  async function plainSetup() {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id, 'No Detail Types');
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = {
      user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta,
    };
    const cash = await makeAccount(t.db, biz.id, { code: '1010', name: 'Operating Cash', account_type: 'asset' });
    const savings = await makeAccount(t.db, biz.id, { code: '1021', name: 'Business Savings Account', account_type: 'asset' });
    const notes = await makeAccount(t.db, biz.id, { code: '2500', name: 'Notes Payable', account_type: 'liability' });
    const card = await makeAccount(t.db, biz.id, { code: '2400', name: 'Company Credit Cards', account_type: 'liability' });
    const bank = await makeBankAccount(t.db, biz.id, cash.id, { name: 'Operating' });
    return { ctx, bank, savings, notes, card };
  }

  it('matches a plural "Notes Payable" for a loan payment', async () => {
    const { ctx, bank, notes } = await plainSetup();
    const result = await autoCoding.suggestCoding(t.db, ctx, input({
      description: 'SBA LOAN PAYMENT',
      amount: '12000.0000',
      bank_account_id: bank.id,
    }));
    expect(result).toMatchObject({ source_layer: 'accounting_rule' });
    expect(result!.lines[0]!.account_id).toBe(notes.id);
  });

  it('matches a plural "Company Credit Cards" for a card payment', async () => {
    const { ctx, bank, card } = await plainSetup();
    const result = await autoCoding.suggestCoding(t.db, ctx, input({
      description: 'CHASE CARD PAYMENT',
      bank_account_id: bank.id,
    }));
    expect(result).toMatchObject({ source_layer: 'accounting_rule' });
    expect(result!.lines[0]!.account_id).toBe(card.id);
  });

  it('routes a transfer to a cash account found by name', async () => {
    const { ctx, bank, savings } = await plainSetup();
    const result = await autoCoding.suggestCoding(t.db, ctx, input({
      description: 'TRANSFER TO SAVINGS',
      amount: '10000.0000',
      bank_account_id: bank.id,
    }));
    expect(result).toMatchObject({ source_layer: 'accounting_rule' });
    expect(result!.lines[0]!.account_id).toBe(savings.id);
  });

  it('still refuses to treat an asset clearing account as a card liability', async () => {
    const { ctx, bank } = await plainSetup();
    // Drop the liability card; only an asset "clearing" account remains.
    await t.db.deleteFrom('chart_of_accounts').where('code', '=', '2400')
      .where('business_id', '=', ctx.business_id!).execute();
    await makeAccount(t.db, ctx.business_id!, {
      code: '1024', name: 'Business Credit Card Clearing', account_type: 'asset',
    });

    const result = await autoCoding.suggestCoding(t.db, ctx, input({
      description: 'CHASE CARD PAYMENT',
      bank_account_id: bank.id,
    }));
    // No liability to post to, so the rule declines rather than guessing at an asset.
    expect(result).toBeNull();
  });
});

describe('autoCodingService.learningDecision', () => {
  it('learns when the accountant explicitly asks, and marks an override as a correction', () => {
    expect(autoCoding.learningDecision({
      suggestedAccountId: 'a', chosenAccountId: 'b',
      sourceLayer: 'ai', userAskedToRemember: true,
    })).toEqual({ wasCorrection: true });

    expect(autoCoding.learningDecision({
      suggestedAccountId: 'a', chosenAccountId: 'a',
      sourceLayer: 'ai', userAskedToRemember: true,
    })).toEqual({ wasCorrection: false });
  });

  it('reinforces an existing learned rule accepted unchanged', () => {
    expect(autoCoding.learningDecision({
      suggestedAccountId: 'a', chosenAccountId: 'a',
      sourceLayer: 'learned_rule', userAskedToRemember: false,
    })).toEqual({ wasCorrection: false });
  });

  it('does NOT turn a silently accepted AI guess into a rule', () => {
    // Otherwise one unreviewed approval hardens into a 99-confidence rule.
    for (const layer of ['ai', 'history', 'vendor_default', 'accounting_rule'] as const) {
      expect(autoCoding.learningDecision({
        suggestedAccountId: 'a', chosenAccountId: 'a',
        sourceLayer: layer, userAskedToRemember: false,
      })).toBeNull();
    }
  });

  it('does not learn from a silent override either', () => {
    expect(autoCoding.learningDecision({
      suggestedAccountId: 'a', chosenAccountId: 'b',
      sourceLayer: 'ai', userAskedToRemember: false,
    })).toBeNull();
  });

  it('does not learn when nothing was suggested and the user did not ask', () => {
    expect(autoCoding.learningDecision({
      suggestedAccountId: null, chosenAccountId: 'b',
      sourceLayer: null, userAskedToRemember: false,
    })).toBeNull();
  });
});

describe('autoCodingService.rememberCoding', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('turns an accountant correction into a layer-1 rule for next time', async () => {
    const { ctx, bank, software } = await setup(t);

    await t.db.transaction().execute(trx => autoCoding.rememberCoding(trx, ctx, {
      description: 'MICROSOFT*SUBSCRIPTION 8812',
      direction: 'debit',
      bank_account_id: null,
      lines: [{ account_id: software.id, debit: '100.0000', credit: '0.0000', memo: null }],
      was_correction: true,
    }));

    const stored = await t.db.selectFrom('account_coding_memory').selectAll()
      .where('business_id', '=', ctx.business_id!).executeTakeFirstOrThrow();
    expect(stored).toMatchObject({
      normalized_vendor: 'microsoft',
      direction: 'debit',
      times_applied: 1,
      times_corrected: 1,
    });

    // The very next identical transaction is now a learned-rule hit.
    const result = await autoCoding.suggestCoding(t.db, ctx, input({
      description: 'MICROSOFT*SUBSCRIPTION 9903',
      bank_account_id: bank.id,
    }));
    expect(result).toMatchObject({ source_layer: 'learned_rule', confidence: 99 });
    expect(result!.lines[0]!.account_id).toBe(software.id);
  });

  it('reinforces an existing rule instead of duplicating it', async () => {
    const { ctx, software, utilities } = await setup(t);
    const remember = (accountId: string, wasCorrection: boolean) =>
      t.db.transaction().execute(trx => autoCoding.rememberCoding(trx, ctx, {
        description: 'MICROSOFT 8812',
        direction: 'debit',
        bank_account_id: null,
        lines: [{ account_id: accountId, debit: '100.0000', credit: '0.0000', memo: null }],
        was_correction: wasCorrection,
      }));

    await remember(utilities.id, true);
    await remember(software.id, true);

    const rows = await t.db.selectFrom('account_coding_memory').selectAll()
      .where('business_id', '=', ctx.business_id!).execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ times_applied: 2, times_corrected: 2 });
    // The most recent correction wins.
    expect((rows[0]!.lines as Array<{ account_id: string }>)[0]!.account_id).toBe(software.id);
  });

  it('closes the correction loop: AI guess -> override -> learned rule wins', async () => {
    const { ctx, bank, utilities, software } = await setup(t);

    // 1. With nothing learned, the model's proposal is all we have.
    const before = await autoCoding.suggestCoding(t.db, ctx, input({
      description: 'MICROSOFT*SUBSCRIPTION 8812',
      bank_account_id: bank.id,
      ai_suggested_account: 'Utilities',
    }));
    expect(before).toMatchObject({ source_layer: 'ai', confidence: 85 });
    expect(before!.lines[0]!.account_id).toBe(utilities.id);

    // 2. The accountant picks a different account and asks to remember it.
    const decision = autoCoding.learningDecision({
      suggestedAccountId: before!.lines[0]!.account_id,
      chosenAccountId: software.id,
      sourceLayer: before!.source_layer,
      userAskedToRemember: true,
    });
    expect(decision).toEqual({ wasCorrection: true });

    await t.db.transaction().execute(trx => autoCoding.rememberCoding(trx, ctx, {
      description: 'MICROSOFT*SUBSCRIPTION 8812',
      direction: 'debit',
      bank_account_id: null,
      lines: [{ account_id: software.id, debit: '89.0000', credit: '0.0000', memo: null }],
      was_correction: decision!.wasCorrection,
    }));

    // 3. A different Microsoft descriptor now resolves from the learned rule,
    //    and the model's contrary opinion no longer matters.
    const after = await autoCoding.suggestCoding(t.db, ctx, input({
      description: 'MICROSOFT*OFFICE365 9903',
      amount: '120.0000',
      bank_account_id: bank.id,
      ai_suggested_account: 'Utilities',
    }));
    expect(after).toMatchObject({ source_layer: 'learned_rule', confidence: 99, band: 'auto_post' });
    expect(after!.lines[0]!.account_id).toBe(software.id);
    // The stored template carries the shape; the amount comes from this row.
    expect(after!.lines[0]!.debit).toBe('120.0000');
  });

  it('ignores a description with no usable vendor token', async () => {
    const { ctx, software } = await setup(t);
    await t.db.transaction().execute(trx => autoCoding.rememberCoding(trx, ctx, {
      description: '#4456 0921',
      direction: 'debit',
      bank_account_id: null,
      lines: [{ account_id: software.id, debit: '1.0000', credit: '0.0000', memo: null }],
      was_correction: false,
    }));
    const rows = await t.db.selectFrom('account_coding_memory').selectAll().execute();
    expect(rows).toHaveLength(0);
  });
});
