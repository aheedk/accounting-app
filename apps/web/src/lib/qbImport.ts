import { importType } from '@/lib/accountImportTypes';

// Reading QuickBooks' own exports for Setup -> Import from QuickBooks. A sheet
// arrives as rows of text cells (as Excel shows them). QuickBooks puts a few
// title rows above the column headers, groups rows under a customer or vendor
// line, and adds "Total for ..." rows; all of that is read past here. Each
// reader returns the rows the API takes, and what it could not read.
// Spec: docs/specs/2026-10-28-quickbooks-import-design.md.

export type Grid = string[][];
export type Parsed<T> = { rows: T[]; problems: string[] };

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
const cell = (row: string[] | undefined, i: number | undefined) => (row && i !== undefined ? (row[i] ?? '').trim() : '');

/** "1,234.56", "(1,234.56)", "-$1,234.56" -> "1234.56" / "-1234.56"; '' for a blank cell; null for anything else. */
export function parseAmount(text: string): string | null | '' {
  let s = text.trim();
  if (s === '' || s === '-') return '';
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (s.endsWith('-')) { negative = !negative; s = s.slice(0, -1); }
  if (s.startsWith('-')) { negative = !negative; s = s.slice(1); }
  s = s.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d+)?$/.test(s) && !/^\.\d+$/.test(s)) return null;
  const n = Number(s);
  if (n === 0) return '0';
  return `${negative ? '-' : ''}${s.startsWith('.') ? `0${s}` : s}`;
}

/** "10/31/2026", "10/31/26", "2026-10-31" -> "2026-10-31"; null when it is not a date. */
export function parseDate(text: string): string | null {
  const s = text.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
  if (m) {
    const year = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return iso(year, Number(m[1]), Number(m[2]));
  }
  return null;
}

function iso(y: number, mo: number, d: number): string | null {
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** "Net 30" -> 30, "Due on receipt" -> 0. */
export function termsDays(text: string): number | null {
  const s = norm(text);
  if (s === '') return null;
  if (s.includes('receipt')) return 0;
  const m = /(\d{1,3})/.exec(s);
  return m ? Math.min(Number(m[1]), 365) : null;
}

type Columns<A> = Partial<Record<keyof A & string, number>>;

/**
 * The header row: the first of the top rows that names every column in
 * `required`. Returns where it is and which column each key is in.
 */
export function findHeader<A extends Record<string, string[]>>(
  grid: Grid, aliases: A, required: (keyof A & string)[],
): { at: number; cols: Columns<A> } | null {
  const keys = Object.keys(aliases) as (keyof A & string)[];
  for (let at = 0; at < Math.min(grid.length, 40); at++) {
    const cols: Columns<A> = {};
    (grid[at] ?? []).forEach((text, i) => {
      const key = keys.find(k => aliases[k]!.includes(norm(text)));
      if (key && cols[key] === undefined) cols[key] = i;
    });
    if (required.every(k => cols[k] !== undefined)) return { at, cols };
  }
  return null;
}

const missingHeader = (what: string, needs: string) =>
  `Couldn't find the column headings. This should be QuickBooks' ${what} export, with columns for ${needs}`;

/** A row that is only a heading: text in one cell, the rest empty. */
function headingOf(row: string[]): string | null {
  const filled = row.map(c => c.trim()).filter(c => c !== '');
  return filled.length === 1 ? filled[0]! : null;
}

const isTotal = (text: string) => /^total\b/i.test(text.trim());

// ---- Step 1: lists -------------------------------------------------------

export type AccountRow = { name: string; number: string | null; account_type: string; detail_type: string | null; description: string | null };

const ACCOUNT_COLS = {
  name: ['account', 'name', 'account name', 'full name', 'account full name'],
  number: ['account #', 'account number', 'number', 'no.', 'acct #', 'acct no.', 'num'],
  type: ['type', 'account type'],
  detail: ['detail type', 'detail_type'],
  description: ['description'],
};

export function parseAccounts(grid: Grid): Parsed<AccountRow> {
  const header = findHeader(grid, ACCOUNT_COLS, ['name', 'type']);
  if (!header) return { rows: [], problems: [missingHeader('Account List', 'the account and its type')] };
  const rows: AccountRow[] = [];
  const problems: string[] = [];
  for (const row of grid.slice(header.at + 1)) {
    const name = cell(row, header.cols.name);
    const typeName = cell(row, header.cols.type);
    if (name === '' || isTotal(name)) continue;
    const type = importType(typeName);
    if (!type) { problems.push(`${name}: QuickBooks type "${typeName}" isn't one this page knows`); continue; }
    rows.push({
      name, number: cell(row, header.cols.number) || null, account_type: type.type,
      detail_type: cell(row, header.cols.detail) || type.detail || null,
      description: cell(row, header.cols.description) || null,
    });
  }
  return { rows, problems };
}

type Address = { line1?: string; city?: string; state?: string; postal_code?: string; country?: string };
export type ContactRow = {
  name: string; company_name: string | null; email: string | null; phone: string | null;
  billing_address: Address | null; terms_days: number | null; notes: string | null; account_number?: string | null;
};

const CONTACT_COLS = {
  name: ['customer', 'vendor', 'name', 'display name', 'customer full name', 'vendor full name', 'full name'],
  company: ['company', 'company name'],
  email: ['email', 'email address', 'e-mail'],
  phone: ['phone', 'phone number', 'phone numbers', 'phone 1'],
  address: ['billing address', 'address', 'bill to'],
  street: ['billing street', 'street', 'billing address line 1', 'street address'],
  city: ['billing city', 'city'],
  state: ['billing state', 'state', 'state/province'],
  zip: ['billing zip', 'zip', 'zip code', 'postal code', 'billing zip code'],
  country: ['billing country', 'country'],
  terms: ['terms'],
  notes: ['notes', 'note'],
  account: ['account #', 'account number', 'account no.'],
};

export function parseContacts(grid: Grid, what: 'Customers' | 'Vendors'): Parsed<ContactRow> {
  const header = findHeader(grid, CONTACT_COLS, ['name']);
  if (!header) return { rows: [], problems: [missingHeader(`${what} list`, 'the name')] };
  const c = header.cols;
  const rows: ContactRow[] = [];
  for (const row of grid.slice(header.at + 1)) {
    const name = cell(row, c.name);
    if (name === '' || isTotal(name)) continue;
    const street = cell(row, c.street) || cell(row, c.address);
    const address: Address = {};
    if (street) address.line1 = street.slice(0, 200);
    if (cell(row, c.city)) address.city = cell(row, c.city).slice(0, 100);
    if (cell(row, c.state)) address.state = cell(row, c.state).slice(0, 50);
    if (cell(row, c.zip)) address.postal_code = cell(row, c.zip).slice(0, 20);
    if (cell(row, c.country)) address.country = cell(row, c.country).slice(0, 80);
    rows.push({
      name: name.slice(0, 200), company_name: cell(row, c.company) || null,
      email: cell(row, c.email).split(/[,;\s]+/)[0] || null,
      phone: cell(row, c.phone).slice(0, 40) || null,
      billing_address: Object.keys(address).length > 0 ? address : null,
      terms_days: termsDays(cell(row, c.terms)),
      notes: cell(row, c.notes) || null,
      ...(what === 'Vendors' ? { account_number: cell(row, c.account) || null } : {}),
    });
  }
  return { rows, problems: [] };
}

export type ItemRow = {
  name: string; sku: string | null; description: string | null; sale_price: string | null; purchase_cost: string | null;
  income_account: string | null; expense_account: string | null; inventory_asset_account: string | null; quantity_on_hand: string | null;
};

const ITEM_COLS = {
  name: ['product/service name', 'product/service', 'name', 'item', 'item name'],
  sku: ['sku'],
  type: ['type', 'item type'],
  description: ['sales description', 'description'],
  price: ['sales price / rate', 'sales price/rate', 'sales price', 'price', 'rate'],
  cost: ['purchase cost', 'cost'],
  income: ['income account'],
  expense: ['expense account'],
  asset: ['inventory asset account'],
  qty: ['quantity on hand', 'qty on hand', 'quantity'],
};

export function parseItems(grid: Grid): Parsed<ItemRow> {
  const header = findHeader(grid, ITEM_COLS, ['name']);
  if (!header) return { rows: [], problems: [missingHeader('Products and Services', 'the product or service name')] };
  const c = header.cols;
  const rows: ItemRow[] = [];
  const problems: string[] = [];
  const money = (row: string[], i: number | undefined, name: string, what: string) => {
    const v = parseAmount(cell(row, i));
    if (v === null) { problems.push(`${name}: ${what} "${cell(row, i)}" isn't a number`); return null; }
    return v === '' ? null : v;
  };
  for (const row of grid.slice(header.at + 1)) {
    const name = cell(row, c.name);
    if (name === '' || isTotal(name)) continue;
    // A bundle is a list of other items, and a category only groups them; neither is an item here.
    if (/^(bundle|group|category)$/i.test(cell(row, c.type))) continue;
    rows.push({
      name: name.slice(0, 200), sku: cell(row, c.sku) || null, description: cell(row, c.description) || null,
      sale_price: money(row, c.price, name, 'price'), purchase_cost: money(row, c.cost, name, 'cost'),
      income_account: cell(row, c.income) || null, expense_account: cell(row, c.expense) || null,
      inventory_asset_account: cell(row, c.asset) || null, quantity_on_hand: money(row, c.qty, name, 'quantity'),
    });
  }
  return { rows, problems };
}

// ---- Step 3: open invoices and unpaid bills --------------------------------

export type OpenItemRow = { name: string; type: string; date: string; number: string | null; due_date: string | null; terms: string | null; amount: string };

const OPEN_COLS = {
  date: ['date', 'transaction date'],
  type: ['transaction type', 'type'],
  number: ['num', 'no.', 'number', 'ref no.'],
  name: ['customer', 'vendor', 'name', 'customer full name', 'vendor full name'],
  due: ['due date'],
  terms: ['terms'],
  open: ['open balance', 'balance', 'open bal'],
  amount: ['amount'],
};

/** QuickBooks' Open Invoices or Unpaid Bills report (or the aging detail): each open row under its customer or vendor. */
export function parseOpenItems(grid: Grid, what: 'Open Invoices' | 'Unpaid Bills'): Parsed<OpenItemRow> {
  const header = findHeader(grid, OPEN_COLS, ['date', 'type']);
  const c = header?.cols;
  if (!header || !c || (c.open === undefined && c.amount === undefined)) {
    return { rows: [], problems: [missingHeader(`${what} report`, 'the date, transaction type and open balance')] };
  }
  const rows: OpenItemRow[] = [];
  const problems: string[] = [];
  let group: string | null = null;
  for (const row of grid.slice(header.at + 1)) {
    const heading = headingOf(row);
    if (heading !== null) {
      if (!isTotal(heading)) group = heading;
      continue;
    }
    const date = parseDate(cell(row, c.date));
    if (!date) continue;
    const name = cell(row, c.name) || group;
    const amountText = cell(row, c.open ?? c.amount);
    const amount = parseAmount(amountText);
    if (!name) { problems.push(`A row dated ${date} isn't under a ${what === 'Open Invoices' ? 'customer' : 'vendor'}`); continue; }
    if (amount === null || amount === '') { problems.push(`${name}, ${date}: open balance "${amountText}" isn't a number`); continue; }
    rows.push({
      name, type: cell(row, c.type) || (what === 'Open Invoices' ? 'Invoice' : 'Bill'), date,
      number: cell(row, c.number) || null, due_date: parseDate(cell(row, c.due)), terms: cell(row, c.terms) || null, amount,
    });
  }
  return { rows, problems };
}

// ---- Step 4: uncleared bank and card items -----------------------------

export type UnclearedRow = { date: string; type: string | null; number: string | null; name: string | null; memo: string | null; amount: string };

const UNCLEARED_COLS = {
  date: ['date', 'transaction date'],
  type: ['type', 'transaction type'],
  number: ['num', 'no.', 'ref no.', 'check #', 'number'],
  name: ['name', 'payee'],
  memo: ['memo', 'memo/description', 'description'],
  amount: ['amount'],
  payment: ['payment', 'payments', 'withdrawal', 'charge', 'credit'],
  deposit: ['deposit', 'deposits', 'debit'],
};

/**
 * QuickBooks' reconciliation report (its uncleared sections), or a list of
 * the account's uncleared transactions. Money into the account is positive.
 */
export function parseUncleared(grid: Grid): Parsed<UnclearedRow> {
  const header = findHeader(grid, UNCLEARED_COLS, ['date']);
  const c = header?.cols;
  if (!header || !c || (c.amount === undefined && c.payment === undefined && c.deposit === undefined)) {
    return { rows: [], problems: [missingHeader('reconciliation report or register', 'the date and the amount')] };
  }
  const body = grid.slice(header.at + 1);
  // A reconciliation report has cleared sections too; only the uncleared ones count.
  const sectioned = body.some(r => /uncleared/i.test(headingOf(r) ?? ''));
  let inUncleared = !sectioned;
  let sign: 1 | -1 | 0 = 0;
  const rows: UnclearedRow[] = [];
  const problems: string[] = [];
  for (const row of body) {
    const heading = headingOf(row);
    if (heading !== null) {
      if (isTotal(heading)) continue;
      if (/uncleared/i.test(heading)) inUncleared = true;
      else if (/cleared/i.test(heading)) inUncleared = false;
      if (/checks and payments|charges|payments and other debits|withdrawals/i.test(heading)) sign = -1;
      else if (/deposits|payments and credits|credits/i.test(heading)) sign = 1;
      continue;
    }
    if (!inUncleared) continue;
    const date = parseDate(cell(row, c.date));
    if (!date) continue;
    let amount: string | null | '';
    if (c.amount !== undefined) amount = parseAmount(cell(row, c.amount));
    else {
      const dep = parseAmount(cell(row, c.deposit));
      const pay = parseAmount(cell(row, c.payment));
      amount = dep === null || pay === null ? null : (Number(dep || 0) - Number(pay || 0)).toFixed(2);
    }
    if (amount === null || amount === '') { problems.push(`${date}: the amount isn't a number`); continue; }
    if (sign !== 0) amount = (sign * Math.abs(Number(amount))).toFixed(2);
    rows.push({
      date, type: cell(row, c.type) || null, number: cell(row, c.number) || null,
      name: cell(row, c.name) || null, memo: cell(row, c.memo) || null, amount,
    });
  }
  return { rows, problems };
}

// ---- Step 2: the trial balance -------------------------------------------

export type TrialBalanceLine = { account: string; debit: string; credit: string };

const TB_COLS = { account: ['account', ''], debit: ['debit'], credit: ['credit'] };

/** QuickBooks' Trial Balance report: one row an account, its debit or credit. */
export function parseTrialBalance(grid: Grid): Parsed<TrialBalanceLine> {
  const header = findHeader(grid, { debit: TB_COLS.debit, credit: TB_COLS.credit }, ['debit', 'credit']);
  if (!header) return { rows: [], problems: [missingHeader('Trial Balance report', 'Debit and Credit')] };
  const headRow = grid[header.at] ?? [];
  const named = headRow.findIndex(h => norm(h) === 'account');
  const accountCol = named >= 0 ? named : 0;
  const rows: TrialBalanceLine[] = [];
  const problems: string[] = [];
  for (const row of grid.slice(header.at + 1)) {
    const account = cell(row, accountCol);
    if (account === '' || isTotal(account)) continue;
    const debit = parseAmount(cell(row, header.cols.debit));
    const credit = parseAmount(cell(row, header.cols.credit));
    if (debit === null || credit === null) { problems.push(`${account}: the amount isn't a number`); continue; }
    if (debit === '' && credit === '') continue;
    // A negative debit is a credit, and the other way round.
    const net = Number(debit || 0) - Number(credit || 0);
    if (Math.abs(net) < 0.005) continue;
    rows.push({ account, debit: net > 0 ? net.toFixed(2) : '0', credit: net < 0 ? (-net).toFixed(2) : '0' });
  }
  return { rows, problems };
}

// ---- Step 5: history -----------------------------------------------------

export type HistoryLine = { account: string; debit: string; credit: string; memo: string | null; name: string | null };
export type HistoryTransaction = { date: string; type: string | null; number: string | null; name: string | null; memo: string | null; lines: HistoryLine[] };

const JOURNAL_COLS = {
  date: ['date', 'transaction date'],
  type: ['transaction type', 'type'],
  number: ['num', 'no.', 'ref no.'],
  name: ['name'],
  memo: ['memo/description', 'memo', 'description'],
  account: ['account', 'account full name', 'account name', 'split'],
  debit: ['debit'],
  credit: ['credit'],
};

/** QuickBooks' Journal report: each transaction's first row has its date; the rest are its other lines. */
export function parseJournal(grid: Grid): Parsed<HistoryTransaction> {
  const header = findHeader(grid, JOURNAL_COLS, ['date', 'account', 'debit', 'credit']);
  if (!header) return { rows: [], problems: [missingHeader('Journal report', 'Date, Account, Debit and Credit')] };
  const c = header.cols;
  const rows: HistoryTransaction[] = [];
  const problems: string[] = [];
  let current: HistoryTransaction | null = null;
  let key = '';
  for (const row of grid.slice(header.at + 1)) {
    const account = cell(row, c.account);
    const dateText = cell(row, c.date);
    const debit = parseAmount(cell(row, c.debit));
    const credit = parseAmount(cell(row, c.credit));
    if (account === '') {
      // The total row under each transaction (or a blank line) ends it.
      current = null;
      continue;
    }
    if (isTotal(account) || isTotal(dateText)) { current = null; continue; }
    const date = parseDate(dateText);
    const rowKey = `${date}|${cell(row, c.type)}|${cell(row, c.number)}`;
    if (date && (!current || rowKey !== key)) {
      current = { date, type: cell(row, c.type) || null, number: cell(row, c.number) || null, name: cell(row, c.name) || null, memo: cell(row, c.memo) || null, lines: [] };
      key = rowKey;
      rows.push(current);
    }
    if (!current) continue;
    if (debit === null || credit === null) { problems.push(`${current.date} ${current.type ?? ''} ${current.number ?? ''}: an amount isn't a number`); continue; }
    if (debit === '' && credit === '') continue;
    current.lines.push({
      account, debit: debit === '' ? '0' : Math.abs(Number(debit)).toFixed(2), credit: credit === '' ? '0' : Math.abs(Number(credit)).toFixed(2),
      memo: cell(row, c.memo) || null, name: cell(row, c.name) || null,
    });
  }
  return { rows: rows.filter(t => t.lines.length > 0), problems };
}
