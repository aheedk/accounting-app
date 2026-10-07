import { type Kysely } from 'kysely';
import { addMoney, subMoney, toMoneyString } from '@accounting/shared';
import type { DB } from '../../db/types.js';

// Statement of Cash Flows, indirect method: start from net income and explain
// the change in cash by the change in every other balance sheet account.
// Spec: docs/specs/2026-10-07-report-set-design.md

export type CashFlowStatementLine = {
  account_id: string;
  account_code: string;
  account_name: string;
  /** Effect on cash: positive adds cash, negative uses it. */
  amount: string;
};

export type CashFlowStatement = {
  period_start: string;
  period_end: string;
  net_income: string;
  /** Changes in operating accounts (receivables, payables, depreciation...). */
  operating_adjustments: CashFlowStatementLine[];
  operating_total: string;
  investing: CashFlowStatementLine[];
  investing_total: string;
  financing: CashFlowStatementLine[];
  financing_total: string;
  net_change_in_cash: string;
  cash_beginning: string;
  cash_ending: string;
};

type Section = 'cash' | 'operating' | 'investing' | 'financing' | 'income';

// Detail types as grouped in the Chart of Accounts.
const BANK_DETAIL_TYPES = new Set(['Cash on hand', 'Checking', 'Money Market', 'Rents Held in Trust', 'Savings', 'Trust account']);
const FIXED_ASSET_DETAIL_TYPES = new Set([
  'Buildings', 'Depletable Assets', 'Fixed Asset Computers', 'Fixed Asset Copiers', 'Fixed Asset Furniture',
  'Fixed Asset Other Tools Equipment', 'Fixed Asset Phone', 'Fixed Asset Photo Video', 'Fixed Asset Software',
  'Furniture & Fixtures', 'Intangible Assets', 'Land', 'Leasehold Improvements', 'Machinery & Equipment',
  'Other fixed assets', 'Vehicles',
]);
const OTHER_ASSET_DETAIL_TYPES = new Set([
  'Goodwill', 'Lease Buyout', 'Licenses', 'Organizational Costs', 'Other Long-term Assets', 'Security Deposits',
]);
const LONG_TERM_LIABILITY_DETAIL_TYPES = new Set(['Notes Payable', 'Other Long Term Liabilities', 'Shareholder Notes Payable']);

type AccountInfo = { account_type: string; detail_type: string | null; name: string };

/**
 * Which part of the statement an account belongs to. Read from the detail type;
 * an account with none (older charts) is placed by its name. Anything not
 * recognised as cash, a long-lived asset or long-term debt is operating.
 */
export function cashFlowSection(account: AccountInfo, underBanking: boolean): Section {
  const { account_type: type, detail_type: detail, name } = account;
  if (type === 'revenue' || type === 'expense') return 'income';
  if (type === 'equity') return 'financing';

  if (type === 'asset') {
    if (underBanking || (detail !== null && BANK_DETAIL_TYPES.has(detail))) return 'cash';
    // Depreciation is an expense that used no cash, so its build-up is added back under operating.
    if (/accumulated/i.test(detail ?? '') || /accumulated/i.test(name)) return 'operating';
    if (detail !== null) {
      return FIXED_ASSET_DETAIL_TYPES.has(detail) || OTHER_ASSET_DETAIL_TYPES.has(detail) ? 'investing' : 'operating';
    }
    if (/\b(cash|checking|savings|money market)\b/i.test(name) && !/clearing|undeposited/i.test(name)) return 'cash';
    if (/equipment|vehicle|furniture|building|\bland\b|leasehold|machinery|computer|fixed asset|goodwill/i.test(name)) return 'investing';
    return 'operating';
  }

  // Liabilities: long-term debt is financing; payables, cards and accruals are operating.
  if (detail !== null) return LONG_TERM_LIABILITY_DETAIL_TYPES.has(detail) ? 'financing' : 'operating';
  return /\bloan|notes? payable|mortgage|long.?term/i.test(name) ? 'financing' : 'operating';
}

function sum(lines: CashFlowStatementLine[]): string {
  return lines.reduce((total, line) => toMoneyString(addMoney(total, line.amount)), '0.0000');
}

export async function statementOfCashFlows(
  db: Kysely<DB>, q: { business_id: string; period_start: string; period_end: string },
): Promise<CashFlowStatement> {
  const accounts = await db.selectFrom('chart_of_accounts')
    .select(['id', 'code', 'name', 'account_type', 'detail_type'])
    .where('business_id', '=', q.business_id)
    .orderBy('code')
    .execute();
  const banking = new Set((await db.selectFrom('bank_accounts').select('cash_account_id')
    .where('business_id', '=', q.business_id)
    .where('deleted_at', 'is', null)
    .execute()).map(row => row.cash_account_id));

  // The ledger's rule: a voided entry and its reversal are both counted and cancel.
  const activity = await db.selectFrom('journal_entry_lines as jel')
    .innerJoin('journal_entries as je', 'je.id', 'jel.journal_entry_id')
    .select(({ fn, eb }) => [
      'jel.account_id',
      fn.sum<string>(eb.case().when('je.entry_date', '<', q.period_start).then(eb.ref('jel.debit')).else(0).end()).as('debit_before'),
      fn.sum<string>(eb.case().when('je.entry_date', '<', q.period_start).then(eb.ref('jel.credit')).else(0).end()).as('credit_before'),
      fn.sum<string>(eb.case().when('je.entry_date', '>=', q.period_start).then(eb.ref('jel.debit')).else(0).end()).as('debit_in'),
      fn.sum<string>(eb.case().when('je.entry_date', '>=', q.period_start).then(eb.ref('jel.credit')).else(0).end()).as('credit_in'),
    ])
    .where('je.business_id', '=', q.business_id)
    .where('je.status', 'in', ['posted', 'voided'])
    .where('je.entry_date', '<=', q.period_end)
    .groupBy('jel.account_id')
    .execute();
  const byAccount = new Map(activity.map(row => [row.account_id, row]));

  let netIncome = '0.0000';
  let cashBeginning = '0.0000';
  let cashChange = '0.0000';
  const sections: Record<'operating' | 'investing' | 'financing', CashFlowStatementLine[]> = {
    operating: [], investing: [], financing: [],
  };

  for (const account of accounts) {
    const row = byAccount.get(account.id);
    if (!row) continue;
    const section = cashFlowSection(account, banking.has(account.id));
    // Every non-cash account affects cash by its credits less its debits.
    const effect = toMoneyString(subMoney(row.credit_in ?? '0', row.debit_in ?? '0'));

    if (section === 'cash') {
      cashBeginning = toMoneyString(addMoney(cashBeginning, subMoney(row.debit_before ?? '0', row.credit_before ?? '0')));
      cashChange = toMoneyString(addMoney(cashChange, subMoney(row.debit_in ?? '0', row.credit_in ?? '0')));
    } else if (section === 'income') {
      netIncome = toMoneyString(addMoney(netIncome, effect));
    } else if (parseFloat(effect) !== 0) {
      sections[section].push({
        account_id: account.id, account_code: account.code, account_name: account.name, amount: effect,
      });
    }
  }

  const investingTotal = sum(sections.investing);
  const financingTotal = sum(sections.financing);
  return {
    period_start: q.period_start,
    period_end: q.period_end,
    net_income: netIncome,
    operating_adjustments: sections.operating,
    operating_total: toMoneyString(addMoney(netIncome, sum(sections.operating))),
    investing: sections.investing,
    investing_total: investingTotal,
    financing: sections.financing,
    financing_total: financingTotal,
    net_change_in_cash: cashChange,
    cash_beginning: cashBeginning,
    cash_ending: toMoneyString(addMoney(cashBeginning, cashChange)),
  };
}
