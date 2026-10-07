// Read-only: runs every financial report for each business and checks that the
// figures that should agree do. Usage, from apps/api:
//   npx tsx --env-file=../../.env scripts/report-tie-out.ts [as_of YYYY-MM-DD]
import { sql } from 'kysely';
import { db, destroyDbSingleton } from '../src/db/index.js';
import * as ledger from '../src/services/core/ledgerService.js';
import { balanceSheet } from '../src/services/reports/balanceSheetService.js';
import { profitLoss } from '../src/services/reports/profitLossService.js';
import { statementOfCashFlows } from '../src/services/reports/statementOfCashFlowsService.js';
import { customerAging } from '../src/services/ar/reports/agingReportService.js';
import { vendorAging } from '../src/services/ap/reports/apAgingReportService.js';

const asOf = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sum = (values: Array<string | number>) => values.reduce<number>((total, v) => total + Number(v), 0);

type Check = { name: string; left: number; right: number; leftLabel: string; rightLabel: string };

async function controlBalance(businessId: string, systemKey: string, sign: 1 | -1): Promise<number> {
  const row = await db.selectFrom('journal_entry_lines as l')
    .innerJoin('journal_entries as je', 'je.id', 'l.journal_entry_id')
    .innerJoin('chart_of_accounts as a', 'a.id', 'l.account_id')
    .select(({ fn }) => [fn.sum<string>('l.debit').as('debit'), fn.sum<string>('l.credit').as('credit')])
    .where('je.business_id', '=', businessId)
    .where('je.status', 'in', ['posted', 'voided'])
    .where('je.entry_date', '<=', asOf)
    .where('a.system_key', '=', systemKey)
    .executeTakeFirst();
  return sign * (Number(row?.debit ?? 0) - Number(row?.credit ?? 0));
}

/** Stock of ledger-tracked items that has been posted, and the balance of the accounts it sits in. */
async function inventoryPosition(businessId: string) {
  const stock = await db.selectFrom('stock_movements as sm')
    .innerJoin('inventory_items as i', 'i.id', 'sm.inventory_item_id')
    .select(({ fn }) => [
      fn.sum<string>(sql<string>`CASE WHEN sm.journal_entry_id IS NOT NULL THEN sm.total_cost ELSE 0 END`).as('posted'),
      fn.sum<string>(sql<string>`CASE WHEN sm.journal_entry_id IS NULL THEN sm.total_cost ELSE 0 END`).as('unposted'),
    ])
    .where('i.business_id', '=', businessId)
    .where('i.inventory_asset_account_id', 'is not', null)
    .where('sm.movement_date', '<=', asOf)
    .executeTakeFirst();
  const ledger = await db.selectFrom('journal_entry_lines as l')
    .innerJoin('journal_entries as je', 'je.id', 'l.journal_entry_id')
    .select(({ fn }) => [fn.sum<string>('l.debit').as('debit'), fn.sum<string>('l.credit').as('credit')])
    .where('je.business_id', '=', businessId)
    .where('je.status', 'in', ['posted', 'voided'])
    .where('je.entry_date', '<=', asOf)
    .where('l.account_id', 'in', db.selectFrom('inventory_items').select('inventory_asset_account_id')
      .where('business_id', '=', businessId).where('inventory_asset_account_id', 'is not', null))
    .executeTakeFirst();
  return {
    posted: Number(stock?.posted ?? 0),
    unposted: Number(stock?.unposted ?? 0),
    ledger: Number(ledger?.debit ?? 0) - Number(ledger?.credit ?? 0),
  };
}

async function main() {
  const businesses = await db.selectFrom('businesses').select(['id', 'name']).orderBy('name').execute();
  let failures = 0;
  for (const business of businesses) {
    const q = { business_id: business.id };
    const tb = await ledger.computeTrialBalance(db, { ...q, as_of: asOf });
    const bs = await balanceSheet(db, { ...q, as_of: asOf });
    // Year to date means the client's fiscal year, which the balance sheet works out.
    const yearStart = bs.fiscal_year_start;
    const pnl = await profitLoss(db, { ...q, period_start: yearStart, period_end: asOf });
    const scf = await statementOfCashFlows(db, { ...q, period_start: yearStart, period_end: asOf });
    const ar = await customerAging(db, { ...q, as_of: asOf });
    const ap = await vendorAging(db, { ...q, as_of: asOf });
    const inventory = await inventoryPosition(business.id);
    const tbRows = (tb as { rows?: Array<{ total_debit?: string; total_credit?: string; debit?: string; credit?: string }> }).rows ?? [];

    const checks: Check[] = [
      {
        name: 'Trial balance is in balance',
        left: sum(tbRows.map(r => r.total_debit ?? r.debit ?? 0)), leftLabel: 'debits',
        right: sum(tbRows.map(r => r.total_credit ?? r.credit ?? 0)), rightLabel: 'credits',
      },
      {
        name: 'Balance sheet balances',
        left: Number(bs.assets_total), leftLabel: 'assets',
        right: Number(bs.liabilities_equity_total), rightLabel: 'liabilities + equity',
      },
      {
        name: 'P&L net income = balance sheet net income (YTD)',
        left: Number(pnl.net_income), leftLabel: 'P&L',
        right: Number(bs.net_income_ytd), rightLabel: 'balance sheet',
      },
      {
        name: 'P&L net income = cash flow statement net income',
        left: Number(pnl.net_income), leftLabel: 'P&L',
        right: Number(scf.net_income), rightLabel: 'cash flows',
      },
      {
        name: 'Cash flow sections add up to the change in cash',
        left: sum([scf.operating_total, scf.investing_total, scf.financing_total]), leftLabel: 'sections',
        right: Number(scf.net_change_in_cash), rightLabel: 'change in cash',
      },
      {
        name: 'A/R aging = Accounts Receivable in the ledger',
        left: sum(ar.map(r => r.total)), leftLabel: 'aging',
        right: await controlBalance(business.id, 'accounts_receivable', 1), rightLabel: 'ledger',
      },
      {
        name: 'A/P aging = Accounts Payable in the ledger',
        left: sum(ap.map(r => r.total)), leftLabel: 'aging',
        right: await controlBalance(business.id, 'accounts_payable', -1), rightLabel: 'ledger',
      },
      {
        name: 'Stock on hand = Inventory in the ledger',
        left: inventory.posted, leftLabel: 'stock',
        right: inventory.ledger, rightLabel: 'ledger',
      },
    ];

    console.log(`\n${business.name}  (as of ${asOf})`);
    for (const check of checks) {
      const ok = Math.abs(check.left - check.right) < 0.005;
      if (!ok) failures += 1;
      console.log(`  ${ok ? 'OK  ' : 'DIFF'}  ${check.name}: ${check.leftLabel} ${money(check.left)}, ${check.rightLabel} ${money(check.right)}`
        + (ok ? '' : `  (off by ${money(check.left - check.right)})`));
    }
    if (Math.abs(inventory.unposted) >= 0.005) {
      console.log(`        ${money(inventory.unposted)} of stock was entered before inventory posted to the ledger; `
        + 'post it from Inventory > Overview.');
    }
    console.log(`        cash ${money(Number(scf.cash_ending))}, net income YTD ${money(Number(pnl.net_income))}, `
      + `net operating income ${money(Number(pnl.operating_income))}`);
  }
  console.log(failures === 0 ? '\nEverything ties.' : `\n${failures} check(s) do not tie.`);
}

main().catch((e: unknown) => { console.error(e); process.exitCode = 1; }).finally(() => destroyDbSingleton());
