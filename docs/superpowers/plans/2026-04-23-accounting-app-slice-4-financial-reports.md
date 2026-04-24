# Slice 4 — Financial Reports + Month-End Close Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the three canonical financial statements (P&L / Income Statement, Balance Sheet, Cash Flow Statement) plus a month-end close workflow that flips fiscal period status to `closed` and blocks further posting. All three reports are read-only over existing journal_entries data — no new entities required.

**Architecture:** Pure read-path additions against the existing ledger. Each report is a service function that runs aggregate SQL over `journal_entries` + `journal_entry_lines` + `chart_of_accounts` for a given `{business_id, as_of | period}`. Month-end close is a single service that validates + flips `fiscal_periods.status` from `'open'` to `'closed'`, with an audit trail. No new tables.

**Tech Stack:** No new deps.

---

## Locked decisions

1. **No new tables.** All three reports compute from existing JE data. Month-end close mutates `fiscal_periods.status` in place.
2. **P&L period:** `{business_id, period_start, period_end}`. Shows Revenue grouped by account, Expense grouped by account, Gross Profit (Revenue - COGS), Operating Income (Gross Profit - Operating Expenses), Net Income. For Slice 4, treat any account with code `50xx` as COGS and any code `60xx-69xx` as Operating Expenses; other expense codes aggregate as "Other Expenses."
3. **Balance Sheet as-of date:** `{business_id, as_of}`. Assets (1xxx), Liabilities (2xxx), Equity (3xxx) + Current-period Net Income (sum of revenue-expense for YTD from fiscal year start). Accounting equation must hold: Assets = Liabilities + Equity + Net Income YTD. Mild tolerance (±$0.0001) for rounding.
4. **Cash Flow Statement (simplified):** `{business_id, period_start, period_end}`. Lists each cash-account JE line in the period (date, source_type, memo, amount, running balance), plus a summary card with Beginning Balance / Ending Balance / Net Change / Net Income for the period. No classic 3-section (operating/investing/financing) breakdown — that's Slice 5+.
5. **Retained earnings rollover:** DEFERRED to Slice 5+. Month-end close in this slice does NOT generate a rollover JE. BS shows current-period net income as a separate equity line until a future slice adds year-end close.
6. **Close preconditions:** month-end close requires (a) period is currently `'open'`, (b) every JE in the period is `posted` (no drafts), (c) trial balance for the period balances. Rejects otherwise.
7. **Reverse a close:** accountant+ role can reopen a closed period via a dedicated `reopenPeriod` endpoint (for error recovery). Emits `fiscal_period.reopen` audit.
8. **Plan-impl sync:** any implementation deviation → patch the plan markdown in the same commit.

---

## Pacing + gotchas (inherits)

- `no-explicit-any: error`
- `exactOptionalPropertyTypes: true`
- `Generated<ColumnType<>>` double-wrap — avoid
- Service signature: `(trx: Transaction<DB>, ctx: ServiceCtx, args: X)` for writes; reports are reads → `(db: Kysely<DB>, q: X)`
- Only `core/ledgerService.postJournalEntry` writes JEs. Slice 4 does NOT post JEs — month-end close only flips the fiscal_period status.
- Router mount: `router.use('/businesses/:businessId', requireAuth, resolveBusiness);`
- Audit trail: write audit rows in same transaction as mutation (close/reopen).
- Money aggregation: use `addMoney`/`subMoney`/`toMoneyString` from `@accounting/shared`. Avoid JS float arithmetic.

---

## Phase A — Shared package updates

### Task 1: Audit actions + zod schemas

**Files:**
- Modify: `packages/shared/src/auditActions.ts`
- Create: `packages/shared/src/schemas/financialReports.ts`
- Modify: `packages/shared/src/schemas/index.ts`

- [ ] **Step 1: Append audit actions**

The AUDIT const already has `fiscal_period.close` and `fiscal_period.reopen`. Verify and add if missing. Also add:

```ts
  FISCAL_PERIOD_CLOSE: 'fiscal_period.close',
  FISCAL_PERIOD_REOPEN: 'fiscal_period.reopen',
```

(If already there from Plan 1.0, skip — verify by grep before adding.)

- [ ] **Step 2: Write `packages/shared/src/schemas/financialReports.ts`**

```ts
import { z } from 'zod';

export const pnlQuerySchema = z.object({
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type PnlQuery = z.infer<typeof pnlQuerySchema>;

export const balanceSheetQuerySchema = z.object({
  as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type BalanceSheetQuery = z.infer<typeof balanceSheetQuerySchema>;

export const cashFlowQuerySchema = z.object({
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cash_account_id: z.string().uuid().optional(),
});
export type CashFlowQuery = z.infer<typeof cashFlowQuerySchema>;

export const periodCloseSchema = z.object({
  period_id: z.string().uuid(),
  memo: z.string().max(500).nullable().optional(),
});

export const periodReopenSchema = z.object({
  period_id: z.string().uuid(),
  reason: z.string().min(1).max(500),
});
```

- [ ] **Step 3: Re-export in index.ts**

Append to `packages/shared/src/schemas/index.ts`:
```ts
export * from './financialReports.js';
```

- [ ] **Step 4: Build + commit**

```bash
npm -w @accounting/shared run build
git add packages/shared/src/auditActions.ts packages/shared/src/schemas/
git commit -m "feat(shared): financial report + period close zod schemas"
```

---

## Phase B — Services

### Task 2: P&L report service (TDD, 2 tests)

**Files:**
- Create: `apps/api/src/services/reports/profitLossService.ts`
- Create: `apps/api/tests/integration/profitLossReport.test.ts`

- [ ] **Step 1: Write tests**

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeCustomer, makeVendor, seedYearPeriods, seedCoa } from '../helpers/factories.js';
import * as invoiceSvc from '../../src/services/ar/invoiceService.js';
import * as billSvc from '../../src/services/ap/billService.js';
import * as rpt from '../../src/services/reports/profitLossService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-000000004001', ip_address: '127.0.0.1', user_agent: 'vitest' };

describe('P&L report', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  async function setup() {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    await seedYearPeriods(t.db, biz.id, 2026);
    await seedCoa(t.db, biz.id);
    const revenue = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id','=',biz.id).where('code','=','4010').executeTakeFirstOrThrow();
    const expense = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id','=',biz.id).where('code','=','5010').executeTakeFirstOrThrow();
    const customer = await makeCustomer(t.db, biz.id, { name: 'Acme' });
    const vendor = await makeVendor(t.db, biz.id, { name: 'Office Supplies' });
    return { biz, ctx, revenue, expense, customer, vendor };
  }

  it('aggregates revenue minus expense for a period', async () => {
    const { biz, ctx, revenue, expense, customer, vendor } = await setup();
    // Post an invoice $1000 (revenue)
    const inv = await t.db.transaction().execute(trx => invoiceSvc.createDraft(trx, ctx, {
      business_id: biz.id, customer_id: customer.id, invoice_number: 'INV-A',
      issue_date: '2026-04-10', due_date: '2026-05-10', memo: null, terms: null,
      lines: [{ description: 'X', quantity: '1', unit_price: '1000.00', revenue_account_id: revenue.id, tax_code_id: null }],
    }));
    await t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctx, { invoice_id: inv.invoice.id }));
    // Post a bill $250 (expense)
    const bill = await t.db.transaction().execute(trx => billSvc.createDraft(trx, ctx, {
      business_id: biz.id, vendor_id: vendor.id, bill_number: 'B-A',
      bill_date: '2026-04-12', due_date: '2026-05-12', memo: null, terms: null,
      lines: [{ description: 'Y', quantity: '1', unit_price: '250.00', expense_account_id: expense.id }],
    }));
    await t.db.transaction().execute(trx => billSvc.postBill(trx, ctx, { bill_id: bill.bill.id }));

    const r = await rpt.profitLoss(t.db, { business_id: biz.id, period_start: '2026-04-01', period_end: '2026-04-30' });
    expect(r.revenue_total).toBe('1000.0000');
    expect(r.expense_total).toBe('250.0000');
    expect(r.net_income).toBe('750.0000');
    expect(r.revenue_lines.find(l => l.account_code === '4010')?.amount).toBe('1000.0000');
    expect(r.expense_lines.find(l => l.account_code === '5010')?.amount).toBe('250.0000');
  });

  it('excludes voided JEs and honors the period window', async () => {
    const { biz, ctx, revenue, customer } = await setup();
    const inv1 = await t.db.transaction().execute(trx => invoiceSvc.createDraft(trx, ctx, {
      business_id: biz.id, customer_id: customer.id, invoice_number: 'INV-B1',
      issue_date: '2026-03-31', due_date: '2026-04-30', memo: null, terms: null,
      lines: [{ description: 'Pre-period', quantity: '1', unit_price: '100.00', revenue_account_id: revenue.id, tax_code_id: null }],
    }));
    await t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctx, { invoice_id: inv1.invoice.id }));

    const inv2 = await t.db.transaction().execute(trx => invoiceSvc.createDraft(trx, ctx, {
      business_id: biz.id, customer_id: customer.id, invoice_number: 'INV-B2',
      issue_date: '2026-04-15', due_date: '2026-05-15', memo: null, terms: null,
      lines: [{ description: 'Will-void', quantity: '1', unit_price: '500.00', revenue_account_id: revenue.id, tax_code_id: null }],
    }));
    await t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctx, { invoice_id: inv2.invoice.id }));
    await t.db.transaction().execute(trx => invoiceSvc.voidInvoice(trx, ctx, { invoice_id: inv2.invoice.id, void_reason: 'test' }));

    const r = await rpt.profitLoss(t.db, { business_id: biz.id, period_start: '2026-04-01', period_end: '2026-04-30' });
    expect(r.revenue_total).toBe('0.0000');  // pre-period excluded, voided excluded
  });
});
```

- [ ] **Step 2: Write service**

```ts
import { type Kysely, sql } from 'kysely';
import { addMoney, subMoney, toMoneyString } from '@accounting/shared';
import type { DB } from '../../db/types.js';

export type PnlLine = {
  account_id: string;
  account_code: string;
  account_name: string;
  amount: string;
};

export type PnlReport = {
  period_start: string;
  period_end: string;
  revenue_lines: PnlLine[];
  revenue_total: string;
  expense_lines: PnlLine[];
  expense_total: string;
  gross_profit: string;  // revenue - COGS (code 50xx)
  operating_expenses_total: string;
  operating_income: string;  // gross_profit - operating_expenses
  other_expenses_total: string;
  net_income: string;
};

export async function profitLoss(db: Kysely<DB>, q: { business_id: string; period_start: string; period_end: string }): Promise<PnlReport> {
  const rows = await db.selectFrom('chart_of_accounts as a')
    .leftJoin('journal_entry_lines as jel', 'jel.account_id', 'a.id')
    .leftJoin('journal_entries as je', 'je.id', 'jel.journal_entry_id')
    .select(({ fn }) => [
      'a.id as account_id', 'a.code', 'a.name', 'a.account_type',
      fn.coalesce(fn.sum<string>('jel.debit'), sql.lit('0')).as('total_debit'),
      fn.coalesce(fn.sum<string>('jel.credit'), sql.lit('0')).as('total_credit'),
    ])
    .where('a.business_id', '=', q.business_id)
    .where('a.account_type', 'in', ['revenue', 'expense'])
    .where(eb => eb.or([
      eb('je.id', 'is', null),
      eb.and([
        eb('je.status', '=', 'posted'),
        eb('je.entry_date', '>=', q.period_start),
        eb('je.entry_date', '<=', q.period_end),
      ]),
    ]))
    .groupBy(['a.id', 'a.code', 'a.name', 'a.account_type'])
    .orderBy('a.code')
    .execute();

  const revenueLines: PnlLine[] = [];
  let revenueTotal = '0.0000';
  const expenseLines: PnlLine[] = [];
  let expenseTotal = '0.0000';
  let cogs = '0.0000';
  let opex = '0.0000';
  let otherExp = '0.0000';

  for (const r of rows) {
    const debit = r.total_debit ?? '0';
    const credit = r.total_credit ?? '0';
    if (r.account_type === 'revenue') {
      // revenue is credit-normal, report as positive (credit - debit)
      const amt = toMoneyString(subMoney(credit, debit));
      if (parseFloat(amt) === 0) continue;
      revenueLines.push({ account_id: r.account_id, account_code: r.code, account_name: r.name, amount: amt });
      revenueTotal = toMoneyString(addMoney(revenueTotal, amt));
    } else {
      // expense is debit-normal
      const amt = toMoneyString(subMoney(debit, credit));
      if (parseFloat(amt) === 0) continue;
      expenseLines.push({ account_id: r.account_id, account_code: r.code, account_name: r.name, amount: amt });
      expenseTotal = toMoneyString(addMoney(expenseTotal, amt));
      if (r.code.startsWith('50')) cogs = toMoneyString(addMoney(cogs, amt));
      else if (r.code.startsWith('6')) opex = toMoneyString(addMoney(opex, amt));
      else otherExp = toMoneyString(addMoney(otherExp, amt));
    }
  }

  const grossProfit = toMoneyString(subMoney(revenueTotal, cogs));
  const operatingIncome = toMoneyString(subMoney(grossProfit, opex));
  const netIncome = toMoneyString(subMoney(revenueTotal, expenseTotal));

  return {
    period_start: q.period_start,
    period_end: q.period_end,
    revenue_lines: revenueLines,
    revenue_total: revenueTotal,
    expense_lines: expenseLines,
    expense_total: expenseTotal,
    gross_profit: grossProfit,
    operating_expenses_total: opex,
    operating_income: operatingIncome,
    other_expenses_total: otherExp,
    net_income: netIncome,
  };
}
```

- [ ] **Step 3: Run + commit**

```bash
npm -w @accounting/api run test:integration -- profitLoss
git add apps/api/src/services/reports/profitLossService.ts apps/api/tests/integration/profitLossReport.test.ts
git commit -m "feat(api): P&L report service with TDD"
```

---

### Task 3: Balance Sheet report service (TDD, 2 tests)

**Files:**
- Create: `apps/api/src/services/reports/balanceSheetService.ts`
- Create: `apps/api/tests/integration/balanceSheetReport.test.ts`

- [ ] **Step 1: Write tests**

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeCustomer, seedYearPeriods, seedCoa } from '../helpers/factories.js';
import * as invoiceSvc from '../../src/services/ar/invoiceService.js';
import * as paymentSvc from '../../src/services/ar/paymentService.js';
import * as rpt from '../../src/services/reports/balanceSheetService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-000000004002', ip_address: '127.0.0.1', user_agent: 'vitest' };

describe('Balance Sheet report', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('accounting equation holds after a full AR cycle', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    await seedYearPeriods(t.db, biz.id, 2026);
    await seedCoa(t.db, biz.id);
    const cash = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id','=',biz.id).where('code','=','1020').executeTakeFirstOrThrow();
    const revenue = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id','=',biz.id).where('code','=','4010').executeTakeFirstOrThrow();
    const customer = await makeCustomer(t.db, biz.id, { name: 'Acme' });

    const inv = await t.db.transaction().execute(trx => invoiceSvc.createDraft(trx, ctx, {
      business_id: biz.id, customer_id: customer.id, invoice_number: 'I-1',
      issue_date: '2026-04-10', due_date: '2026-05-10', memo: null, terms: null,
      lines: [{ description: 'Svc', quantity: '1', unit_price: '500.00', revenue_account_id: revenue.id, tax_code_id: null }],
    }));
    await t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctx, { invoice_id: inv.invoice.id }));

    const pay = await t.db.transaction().execute(trx => paymentSvc.createDraft(trx, ctx, {
      business_id: biz.id, customer_id: customer.id, payment_date: '2026-04-20',
      payment_method: 'check', reference: null, amount: '500.00', cash_account_id: cash.id, memo: null,
      initial_applications: [{ invoice_id: inv.invoice.id, applied_amount: '500.00' }],
    }));
    await t.db.transaction().execute(trx => paymentSvc.postPayment(trx, ctx, { payment_id: pay.payment.id }));

    const bs = await rpt.balanceSheet(t.db, { business_id: biz.id, as_of: '2026-04-30' });
    // Equation: assets = liabilities + equity + net_income_ytd
    const rhs = parseFloat(bs.liabilities_total) + parseFloat(bs.equity_total) + parseFloat(bs.net_income_ytd);
    expect(Math.abs(parseFloat(bs.assets_total) - rhs)).toBeLessThan(0.01);
    // Cash should be +500, Revenue contributes to net_income_ytd = +500
    expect(bs.net_income_ytd).toBe('500.0000');
  });

  it('returns zeros for a fresh business', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    await seedYearPeriods(t.db, biz.id, 2026);
    await seedCoa(t.db, biz.id);
    void user;

    const bs = await rpt.balanceSheet(t.db, { business_id: biz.id, as_of: '2026-04-30' });
    expect(bs.assets_total).toBe('0.0000');
    expect(bs.liabilities_total).toBe('0.0000');
    expect(bs.equity_total).toBe('0.0000');
    expect(bs.net_income_ytd).toBe('0.0000');
  });
});
```

- [ ] **Step 2: Write service**

```ts
import { type Kysely, sql } from 'kysely';
import { addMoney, subMoney, toMoneyString } from '@accounting/shared';
import type { DB } from '../../db/types.js';

export type BsLine = {
  account_id: string;
  account_code: string;
  account_name: string;
  amount: string;
};

export type BalanceSheetReport = {
  as_of: string;
  asset_lines: BsLine[];
  assets_total: string;
  liability_lines: BsLine[];
  liabilities_total: string;
  equity_lines: BsLine[];
  equity_total: string;
  net_income_ytd: string;
  liabilities_equity_total: string;
  in_balance: boolean;
};

export async function balanceSheet(db: Kysely<DB>, q: { business_id: string; as_of: string }): Promise<BalanceSheetReport> {
  const asOfYear = q.as_of.slice(0, 4);
  const ytdStart = `${asOfYear}-01-01`;

  // Aggregate JE lines per account up to as_of date
  const rows = await db.selectFrom('chart_of_accounts as a')
    .leftJoin('journal_entry_lines as jel', 'jel.account_id', 'a.id')
    .leftJoin('journal_entries as je', 'je.id', 'jel.journal_entry_id')
    .select(({ fn }) => [
      'a.id as account_id', 'a.code', 'a.name', 'a.account_type',
      fn.coalesce(fn.sum<string>('jel.debit'), sql.lit('0')).as('total_debit'),
      fn.coalesce(fn.sum<string>('jel.credit'), sql.lit('0')).as('total_credit'),
    ])
    .where('a.business_id', '=', q.business_id)
    .where(eb => eb.or([
      eb('je.id', 'is', null),
      eb.and([
        eb('je.status', '=', 'posted'),
        eb('je.entry_date', '<=', q.as_of),
      ]),
    ]))
    .groupBy(['a.id', 'a.code', 'a.name', 'a.account_type'])
    .orderBy('a.code')
    .execute();

  const assetLines: BsLine[] = [];
  const liabilityLines: BsLine[] = [];
  const equityLines: BsLine[] = [];
  let assetsTotal = '0.0000';
  let liabilitiesTotal = '0.0000';
  let equityTotal = '0.0000';

  for (const r of rows) {
    const debit = r.total_debit ?? '0';
    const credit = r.total_credit ?? '0';
    if (r.account_type === 'asset') {
      const amt = toMoneyString(subMoney(debit, credit));
      if (parseFloat(amt) === 0) continue;
      assetLines.push({ account_id: r.account_id, account_code: r.code, account_name: r.name, amount: amt });
      assetsTotal = toMoneyString(addMoney(assetsTotal, amt));
    } else if (r.account_type === 'liability') {
      const amt = toMoneyString(subMoney(credit, debit));
      if (parseFloat(amt) === 0) continue;
      liabilityLines.push({ account_id: r.account_id, account_code: r.code, account_name: r.name, amount: amt });
      liabilitiesTotal = toMoneyString(addMoney(liabilitiesTotal, amt));
    } else if (r.account_type === 'equity') {
      const amt = toMoneyString(subMoney(credit, debit));
      if (parseFloat(amt) === 0) continue;
      equityLines.push({ account_id: r.account_id, account_code: r.code, account_name: r.name, amount: amt });
      equityTotal = toMoneyString(addMoney(equityTotal, amt));
    }
  }

  // Net income YTD = sum of revenue - expense from ytdStart to as_of
  const niRows = await db.selectFrom('chart_of_accounts as a')
    .leftJoin('journal_entry_lines as jel', 'jel.account_id', 'a.id')
    .leftJoin('journal_entries as je', 'je.id', 'jel.journal_entry_id')
    .select(({ fn }) => [
      'a.account_type',
      fn.coalesce(fn.sum<string>('jel.debit'), sql.lit('0')).as('total_debit'),
      fn.coalesce(fn.sum<string>('jel.credit'), sql.lit('0')).as('total_credit'),
    ])
    .where('a.business_id', '=', q.business_id)
    .where('a.account_type', 'in', ['revenue', 'expense'])
    .where(eb => eb.or([
      eb('je.id', 'is', null),
      eb.and([
        eb('je.status', '=', 'posted'),
        eb('je.entry_date', '>=', ytdStart),
        eb('je.entry_date', '<=', q.as_of),
      ]),
    ]))
    .groupBy('a.account_type')
    .execute();

  let revenue = '0.0000';
  let expense = '0.0000';
  for (const r of niRows) {
    if (r.account_type === 'revenue') revenue = toMoneyString(subMoney(r.total_credit ?? '0', r.total_debit ?? '0'));
    if (r.account_type === 'expense') expense = toMoneyString(subMoney(r.total_debit ?? '0', r.total_credit ?? '0'));
  }
  const netIncomeYtd = toMoneyString(subMoney(revenue, expense));

  const liabEquity = toMoneyString(addMoney(addMoney(liabilitiesTotal, equityTotal), netIncomeYtd));
  const inBalance = Math.abs(parseFloat(assetsTotal) - parseFloat(liabEquity)) < 0.01;

  return {
    as_of: q.as_of,
    asset_lines: assetLines, assets_total: assetsTotal,
    liability_lines: liabilityLines, liabilities_total: liabilitiesTotal,
    equity_lines: equityLines, equity_total: equityTotal,
    net_income_ytd: netIncomeYtd,
    liabilities_equity_total: liabEquity,
    in_balance: inBalance,
  };
}
```

- [ ] **Step 3: Run + commit**

```bash
npm -w @accounting/api run test:integration -- balanceSheet
git add apps/api/src/services/reports/balanceSheetService.ts apps/api/tests/integration/balanceSheetReport.test.ts
git commit -m "feat(api): Balance Sheet report service with TDD"
```

---

### Task 4: Cash Flow Statement service (TDD, 1 test)

**Files:**
- Create: `apps/api/src/services/reports/cashFlowService.ts`
- Create: `apps/api/tests/integration/cashFlowReport.test.ts`

Simplified CFS: enumerate cash-account JE lines in the period. Return beginning balance, ending balance, net change, and a line-by-line activity list.

- [ ] **Step 1: Test**

```ts
// cashFlowReport.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeCustomer, seedYearPeriods, seedCoa } from '../helpers/factories.js';
import * as invoiceSvc from '../../src/services/ar/invoiceService.js';
import * as paymentSvc from '../../src/services/ar/paymentService.js';
import * as rpt from '../../src/services/reports/cashFlowService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-000000004003', ip_address: '127.0.0.1', user_agent: 'vitest' };

describe('Cash Flow report', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('enumerates cash movements with a running balance', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    await seedYearPeriods(t.db, biz.id, 2026);
    await seedCoa(t.db, biz.id);
    const cash = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id','=',biz.id).where('code','=','1020').executeTakeFirstOrThrow();
    const revenue = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id','=',biz.id).where('code','=','4010').executeTakeFirstOrThrow();
    const customer = await makeCustomer(t.db, biz.id, { name: 'Acme' });

    // Create and pay an invoice → cash inflow
    const inv = await t.db.transaction().execute(trx => invoiceSvc.createDraft(trx, ctx, {
      business_id: biz.id, customer_id: customer.id, invoice_number: 'I-CFS',
      issue_date: '2026-04-10', due_date: '2026-05-10', memo: null, terms: null,
      lines: [{ description: 'Svc', quantity: '1', unit_price: '750.00', revenue_account_id: revenue.id, tax_code_id: null }],
    }));
    await t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctx, { invoice_id: inv.invoice.id }));
    const pay = await t.db.transaction().execute(trx => paymentSvc.createDraft(trx, ctx, {
      business_id: biz.id, customer_id: customer.id, payment_date: '2026-04-20',
      payment_method: 'check', reference: null, amount: '750.00', cash_account_id: cash.id, memo: null,
      initial_applications: [{ invoice_id: inv.invoice.id, applied_amount: '750.00' }],
    }));
    await t.db.transaction().execute(trx => paymentSvc.postPayment(trx, ctx, { payment_id: pay.payment.id }));

    const r = await rpt.cashFlow(t.db, { business_id: biz.id, period_start: '2026-04-01', period_end: '2026-04-30' });
    expect(r.beginning_balance).toBe('0.0000');
    expect(r.ending_balance).toBe('750.0000');
    expect(r.net_change).toBe('750.0000');
    expect(r.lines.length).toBe(1);
    expect(r.lines[0]!.net_amount).toBe('750.0000');
    expect(r.lines[0]!.running_balance).toBe('750.0000');
  });
});
```

- [ ] **Step 2: Service**

```ts
import { type Kysely, sql } from 'kysely';
import { addMoney, subMoney, toMoneyString } from '@accounting/shared';
import type { DB } from '../../db/types.js';

export type CashFlowLine = {
  entry_date: string;
  journal_entry_id: string;
  source_type: string;
  memo: string | null;
  debit: string;
  credit: string;
  net_amount: string; // debit - credit (positive = inflow)
  running_balance: string;
};

export type CashFlowReport = {
  period_start: string;
  period_end: string;
  cash_account_id: string;
  cash_account_code: string;
  cash_account_name: string;
  beginning_balance: string;
  ending_balance: string;
  net_change: string;
  lines: CashFlowLine[];
};

async function cashAccountBalance(db: Kysely<DB>, cash_account_id: string, as_of: string): Promise<string> {
  const row = await db.selectFrom('journal_entry_lines as jel')
    .innerJoin('journal_entries as je', 'je.id', 'jel.journal_entry_id')
    .select(({ fn }) => [
      fn.coalesce(fn.sum<string>('jel.debit'), sql.lit('0')).as('total_debit'),
      fn.coalesce(fn.sum<string>('jel.credit'), sql.lit('0')).as('total_credit'),
    ])
    .where('jel.account_id', '=', cash_account_id)
    .where('je.status', '=', 'posted')
    .where('je.entry_date', '<=', as_of)
    .executeTakeFirst();
  return toMoneyString(subMoney(row?.total_debit ?? '0', row?.total_credit ?? '0'));
}

export async function cashFlow(db: Kysely<DB>, q: { business_id: string; period_start: string; period_end: string; cash_account_id?: string }): Promise<CashFlowReport> {
  let cashAccountId = q.cash_account_id;
  let cashCode = '';
  let cashName = '';
  if (!cashAccountId) {
    // Default: use system code 1020 (Operating Bank Account)
    const row = await db.selectFrom('chart_of_accounts').selectAll()
      .where('business_id', '=', q.business_id).where('code', '=', '1020').executeTakeFirstOrThrow();
    cashAccountId = row.id;
    cashCode = row.code;
    cashName = row.name;
  } else {
    const row = await db.selectFrom('chart_of_accounts').selectAll()
      .where('id', '=', cashAccountId).where('business_id', '=', q.business_id).executeTakeFirstOrThrow();
    cashCode = row.code;
    cashName = row.name;
  }

  // Beginning balance = balance one day before period_start
  const dayBefore = new Date(new Date(q.period_start + 'T00:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);
  const beginning = await cashAccountBalance(db, cashAccountId, dayBefore);

  const activity = await db.selectFrom('journal_entry_lines as jel')
    .innerJoin('journal_entries as je', 'je.id', 'jel.journal_entry_id')
    .select(['je.entry_date', 'je.id as journal_entry_id', 'je.source_type', 'je.memo', 'jel.debit', 'jel.credit'])
    .where('jel.account_id', '=', cashAccountId)
    .where('je.status', '=', 'posted')
    .where('je.entry_date', '>=', q.period_start)
    .where('je.entry_date', '<=', q.period_end)
    .orderBy('je.entry_date')
    .orderBy('je.created_at')
    .execute();

  let running = beginning;
  const lines: CashFlowLine[] = activity.map(r => {
    const net = toMoneyString(subMoney(r.debit, r.credit));
    running = toMoneyString(addMoney(running, net));
    return {
      entry_date: r.entry_date, journal_entry_id: r.journal_entry_id,
      source_type: r.source_type, memo: r.memo,
      debit: toMoneyString(addMoney(r.debit, '0')), credit: toMoneyString(addMoney(r.credit, '0')),
      net_amount: net, running_balance: running,
    };
  });

  const ending = await cashAccountBalance(db, cashAccountId, q.period_end);
  const netChange = toMoneyString(subMoney(ending, beginning));

  return {
    period_start: q.period_start, period_end: q.period_end,
    cash_account_id: cashAccountId, cash_account_code: cashCode, cash_account_name: cashName,
    beginning_balance: beginning, ending_balance: ending, net_change: netChange,
    lines,
  };
}
```

- [ ] **Step 3: Run + commit**

```bash
npm -w @accounting/api run test:integration -- cashFlow
git add apps/api/src/services/reports/cashFlowService.ts apps/api/tests/integration/cashFlowReport.test.ts
git commit -m "feat(api): Cash Flow Statement service (simplified) with TDD"
```

---

### Task 5: Period close service (TDD, 2 tests)

**Files:**
- Create: `apps/api/src/services/core/periodCloseService.ts`
- Create: `apps/api/tests/integration/periodClose.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, seedYearPeriods, seedCoa } from '../helpers/factories.js';
import * as close from '../../src/services/core/periodCloseService.js';
import { ERR } from '@accounting/shared';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-000000004004', ip_address: '127.0.0.1', user_agent: 'vitest' };

describe('period close', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  async function setup() {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    await seedYearPeriods(t.db, biz.id, 2026);
    await seedCoa(t.db, biz.id);
    return { biz, ctx };
  }

  it('closePeriod flips status open → closed and emits audit', async () => {
    const { biz, ctx } = await setup();
    const period = await t.db.selectFrom('fiscal_periods').selectAll()
      .where('business_id','=',biz.id).where('period_start','=','2026-04-01').executeTakeFirstOrThrow();
    const result = await t.db.transaction().execute(trx => close.closePeriod(trx, ctx, { period_id: period.id, memo: 'April close' }));
    expect(result.status).toBe('closed');
    const audit = await t.db.selectFrom('audit_logs').selectAll().where('action', '=', 'fiscal_period.close').execute();
    expect(audit).toHaveLength(1);
  });

  it('closePeriod rejects an already-closed period with INVALID_STATE_TRANSITION', async () => {
    const { biz, ctx } = await setup();
    const period = await t.db.selectFrom('fiscal_periods').selectAll()
      .where('business_id','=',biz.id).where('period_start','=','2026-04-01').executeTakeFirstOrThrow();
    await t.db.transaction().execute(trx => close.closePeriod(trx, ctx, { period_id: period.id, memo: null }));
    await expect(
      t.db.transaction().execute(trx => close.closePeriod(trx, ctx, { period_id: period.id, memo: null })),
    ).rejects.toMatchObject({ code: ERR.INVALID_STATE_TRANSITION });
  });
});
```

- [ ] **Step 2: Service**

```ts
import { sql, type Transaction } from 'kysely';
import { AUDIT } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import { NotFoundError } from '../../lib/errors.js';
import { InvalidStateTransitionError } from '../../lib/ledgerErrors.js';
import { record as auditRecord } from '../audit/auditService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export async function closePeriod(trx: Transaction<DB>, ctx: ServiceCtx, input: { period_id: string; memo: string | null }) {
  const p = await trx.selectFrom('fiscal_periods').selectAll().where('id', '=', input.period_id).executeTakeFirst();
  if (!p) throw new NotFoundError('fiscal_period', input.period_id);
  if (p.status !== 'open') throw new InvalidStateTransitionError('fiscal_period', p.id, p.status, 'closed');

  // Reject if any draft JEs exist in the period
  const drafts = await trx.selectFrom('journal_entries').select('id')
    .where('business_id', '=', p.business_id)
    .where('status', '=', 'draft')
    .where('entry_date', '>=', p.period_start)
    .where('entry_date', '<=', p.period_end)
    .execute();
  if (drafts.length > 0) {
    const { PreconditionError } = await import('../../lib/ledgerErrors.js');
    throw new PreconditionError(`Cannot close period with ${drafts.length} draft journal entr${drafts.length === 1 ? 'y' : 'ies'} in the date range`);
  }

  const updated = await trx.updateTable('fiscal_periods')
    .set({ status: 'closed', closed_at: sql`now()`, closed_by_user_id: ctx.user_id, close_memo: input.memo ?? null })
    .where('id', '=', p.id)
    .returningAll().executeTakeFirstOrThrow();
  await auditRecord(trx, ctx, { action: AUDIT.FISCAL_PERIOD_CLOSE, entity_type: 'fiscal_period', entity_id: p.id, before: p, after: updated });
  return updated;
}

export async function reopenPeriod(trx: Transaction<DB>, ctx: ServiceCtx, input: { period_id: string; reason: string }) {
  const p = await trx.selectFrom('fiscal_periods').selectAll().where('id', '=', input.period_id).executeTakeFirst();
  if (!p) throw new NotFoundError('fiscal_period', input.period_id);
  if (p.status !== 'closed') throw new InvalidStateTransitionError('fiscal_period', p.id, p.status, 'open');

  const updated = await trx.updateTable('fiscal_periods')
    .set({ status: 'open', closed_at: null, closed_by_user_id: null, close_memo: null })
    .where('id', '=', p.id)
    .returningAll().executeTakeFirstOrThrow();
  await auditRecord(trx, ctx, { action: AUDIT.FISCAL_PERIOD_REOPEN, entity_type: 'fiscal_period', entity_id: p.id, before: p, after: { ...updated, reopen_reason: input.reason } });
  return updated;
}
```

**Note:** `fiscal_periods` may not yet have `closed_at`, `closed_by_user_id`, `close_memo` columns. If they don't exist, add a migration `db/migrations/0024_fiscal_period_close_fields.sql`:

```sql
ALTER TABLE fiscal_periods ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE fiscal_periods ADD COLUMN IF NOT EXISTS closed_by_user_id uuid REFERENCES users(id);
ALTER TABLE fiscal_periods ADD COLUMN IF NOT EXISTS close_memo text;
```

And update `apps/api/src/db/types.ts` `FiscalPeriodsTable` accordingly.

- [ ] **Step 3: Run + commit**

```bash
npm run db:migrate  # applies 0024 if it was needed
npm -w @accounting/api run test:integration -- periodClose
git add db/migrations/0024_fiscal_period_close_fields.sql apps/api/src/db/types.ts apps/api/src/services/core/periodCloseService.ts apps/api/tests/integration/periodClose.test.ts
git commit -m "feat(api): period close service (close + reopen) with TDD"
```

---

## Phase C — Routes

### Task 6: Financial report + close routes

**Files:**
- Create: `apps/api/src/routes/financialReports.ts`
- Modify: `apps/api/src/routes/fiscalPeriods.ts` (add close + reopen actions)
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write `financialReports.ts`**

Three GET endpoints:
- `GET /businesses/:businessId/reports/pnl?period_start=&period_end=`
- `GET /businesses/:businessId/reports/balance-sheet?as_of=`
- `GET /businesses/:businessId/reports/cash-flow?period_start=&period_end=&cash_account_id=`

Mirror `agingReport.ts` shape. Use respective zod schemas.

- [ ] **Step 2: Extend `fiscalPeriods.ts`**

Add two handlers:
- `POST /businesses/:businessId/periods/:id/close` — requires `accountant+` role. Body: `schemas.periodCloseSchema` — but period_id comes from params; body just carries `memo` optionally.
- `POST /businesses/:businessId/periods/:id/reopen` — requires `firm_admin` role. Body: `{ reason }`.

- [ ] **Step 3: Wire in app.ts** + typecheck + lint + commit

```bash
git add apps/api/src/routes/financialReports.ts apps/api/src/routes/fiscalPeriods.ts apps/api/src/app.ts
git commit -m "feat(api): financial report + period close routes"
```

---

## Phase D — Web pages

### Task 7: P&L page

**Files:** `apps/web/src/pages/reports/ProfitLossPage.tsx`

Features:
- Period range selector (default: current month)
- Table with 2 sections: Revenue (grouped by account code), Expense (grouped by account code)
- Totals footer for each section + Net Income card at top
- Gross Profit / Operating Income / Net Income breakdown card
- Refresh button

Mirror `AgingReportPage.tsx` shape for the loader + error pattern.

Commit: `feat(web): P&L report page`

---

### Task 8: Balance Sheet page

**Files:** `apps/web/src/pages/reports/BalanceSheetPage.tsx`

Features:
- As-of date selector (default today)
- 2-column layout: Assets | Liabilities + Equity
- Each column lists accounts with codes, ends with subtotal
- Net Income YTD appears as the last equity item
- "In balance ✓" / "Out of balance" banner

Commit: `feat(web): Balance Sheet report page`

---

### Task 9: Cash Flow page

**Files:** `apps/web/src/pages/reports/CashFlowPage.tsx`

Features:
- Period range + cash account selector
- Header card: Beginning / Net Change / Ending balance
- Table of activity: date, source, memo, net amount (signed, colored), running balance

Commit: `feat(web): Cash Flow Statement page`

---

### Task 10: Period close UI (extend Periods page)

**Files:** Modify `apps/web/src/pages/periods/PeriodsPage.tsx`

For each period in the list:
- Add a "Close" button (if status=open) — posts to `/periods/:id/close` with optional memo
- Add a "Reopen" button (if status=closed, visible only to firm_admin) — prompts for reason
- Confirmation dialog before either action

Commit: `feat(web): period close/reopen UI in Periods page`

---

### Task 11: Wire routes + sidebar + Standard Reports hub

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/layout/Sidebar.tsx`
- Modify: `apps/web/src/pages/reports/StandardReportsPage.tsx`

Routes:
- `/reports/pnl` → `ProfitLossPage`
- `/reports/balance-sheet` → `BalanceSheetPage`
- `/reports/cash-flow` → `CashFlowPage`

Sidebar Reports group:
- Add "Profit & Loss", "Balance Sheet", "Cash Flow" as children (between Standard Reports and Custom Reports, or as direct links).

Standard Reports hub page: add 3 cards linking to the new reports.

Commit: `feat(web): wire financial reports into routes + sidebar + hub`

---

## Phase E — Deploy

### Task 12: Merge + deploy + smoke

- Merge `slice-4` to main, push
- Wait Railway redeploy (applies 0024 migration if any)
- HTTP smoke:
  - Fetch P&L for April 2026 on Blue Widget → net income matches expected
  - Fetch Balance Sheet as of April 30 → equation holds
  - Fetch Cash Flow for April → non-empty activity list matches prior AR/AP activity
  - Close April 2026 period → status flips → expect any attempt to post a new JE in April to fail (period gate)
  - Reopen April 2026 → status back to open

---

## Definition of Done

- ≥98 (prior) + 7 (new: 2 P&L + 2 BS + 1 CFS + 2 close) = **≥105 tests passing**.
- 3 new report services + period close service with TDD.
- Sidebar Reports group links to real P&L / BS / CFS pages.
- Railway deployed, 0024 migration applied if needed.
- Browser smoke: open each report page; no console errors.
