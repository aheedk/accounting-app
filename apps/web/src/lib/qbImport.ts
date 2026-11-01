import * as XLSX from 'xlsx';
import { importType } from '@/lib/accountImportTypes';

// Reading QuickBooks' own exports for Setup -> Import from QuickBooks. A sheet
// arrives as rows of text cells (as Excel shows them). QuickBooks puts a few
// title rows above the column headers, groups rows under a customer or vendor
// line, adds "Total for ..." rows, and ends with a line saying when the report
// was run; all of that is read past here. Each reader returns the rows the API
// takes, and what it could not read.
// Spec: docs/specs/2026-10-28-quickbooks-import-design.md.

export type Grid = string[][];
/** `notes` are rows left out on purpose, worth a word but stopping nothing. */
export type Parsed<T> = { rows: T[]; problems: string[]; notes?: string[] };

/** The first sheet of an Excel or CSV file, each cell as Excel shows it. */
export function readGrid(data: ArrayBuffer): Grid {
  const wb = XLSX.read(data, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0] ?? ''];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '', blankrows: false })
    .map(row => row.map(c => (c === null || c === undefined ? '' : String(c))));
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
// A heading may carry the currency: "AMOUNT (USD)" on a reconciliation report.
const headingNorm = (s: string) => norm(s).replace(/\s*\((usd|cad|\$)\)$/, '');
const cell = (row: string[] | undefined, i: number | undefined) => (row && i !== undefined ? (row[i] ?? '').trim() : '');
const firstFilled = (row: string[]) => row.map(c => c.trim()).find(c => c !== '') ?? '';

/** The line under a report saying when it was run: "Accrual Basis Friday, October 31, 2026 09:41 AM GMT-04:00". */
function isFooter(row: string[]): boolean {
  const filled = row.map(c => c.trim()).filter(c => c !== '');
  if (filled.length !== 1) return false;
  const text = filled[0]!;
  return /\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)\b/i.test(text)
    && /\b(accrual|cash) basis\b|\b(gmt|utc)\b|\b(mon|tues|wednes|thurs|fri|satur|sun)day\b/i.test(text);
}

/** The rows under the headings, without the report's footer. */
const bodyOf = (grid: Grid, at: number) => grid.slice(at + 1).filter(row => !isFooter(row));

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

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
/** "Oct", "Sept" or "October" -> 10. */
const monthOf = (name: string) => {
  const i = MONTHS.findIndex(m => m.startsWith(name.toLowerCase()));
  return name.length >= 3 && i >= 0 ? i + 1 : null;
};
const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

/**
 * "10/31/2026", "10/31/26", "10-31-2026", "2026-10-31", "Oct 31, 2026",
 * "31-Oct-2026", or Excel's day number (46326) -> "2026-10-31"; null when it is
 * not a date. Slashed dates are month first, as QuickBooks writes them in the US.
 */
export function parseDate(text: string): string | null {
  const s = text.trim();
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(s);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(s);
  if (m) return iso(fullYear(m[3]!), Number(m[1]), Number(m[2]));
  m = /^([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/i.exec(s);
  if (m) { const mo = monthOf(m[1]!); return mo ? iso(Number(m[3]), mo, Number(m[2])) : null; }
  m = /^(\d{1,2})[\s-]([a-z]{3,9})\.?[\s-](\d{2}|\d{4})$/i.exec(s);
  if (m) { const mo = monthOf(m[2]!); return mo ? iso(fullYear(m[3]!), mo, Number(m[1])) : null; }
  // A date cell Excel kept as its day number (days since 1899-12-30), 1954 to 2119.
  if (/^\d{5}$/.test(s) && Number(s) >= 20000 && Number(s) < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + Number(s) * 86_400_000).toISOString().slice(0, 10);
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
      const key = keys.find(k => aliases[k]!.includes(headingNorm(text)));
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

/** A date cell that is filled but isn't a date, and isn't the column's heading repeated (a reconciliation report repeats them). */
const badDate = (text: string, aliases: string[]) => text !== '' && !isTotal(text) && !aliases.includes(headingNorm(text)) && parseDate(text) === null;
const notADate = (text: string) => `"${text}" in the Date column isn't a date this page can read`;

/**
 * Who a grouped row belongs to. QuickBooks puts a sub-customer's heading under
 * its parent's, and closes each with "Total for <name>"; the name is the whole
 * `Parent:Child` path.
 */
class Groups {
  private stack: string[] = [];
  /** Takes a heading or total row; true when it was one. */
  take(row: string[]): boolean {
    const first = firstFilled(row);
    const closing = /^total for\s+(.+)$/i.exec(first);
    if (closing) {
      const name = closing[1]!.trim();
      let at = this.stack.lastIndexOf(name);
      if (at < 0) at = this.stack.lastIndexOf(name.split(':').at(-1)!.trim());
      if (at >= 0) this.stack.length = at;
      return true;
    }
    const heading = headingOf(row);
    if (heading === null) return false;
    if (!isTotal(heading)) this.stack.push(heading);
    return true;
  }
  get name(): string | null {
    const last = this.stack.at(-1);
    if (last === undefined) return null;
    // A heading that is already a full name stands alone.
    return last.includes(':') ? last : this.stack.join(':');
  }
}

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
  for (const row of bodyOf(grid, header.at)) {
    const name = cell(row, header.cols.name);
    const typeName = cell(row, header.cols.type);
    if (name === '' || isTotal(name)) continue;
    // A list grouped by type has a heading row for each ("Bank", "Expenses").
    const heading = headingOf(row);
    if (heading !== null && typeName === '' && importType(heading)) continue;
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

const COUNTRIES = /^(us|usa|u\.s\.a?\.?|united states( of america)?|canada|ca)$/i;

/**
 * A whole address in one cell, as the contact lists give it: "1 Main St,
 * Austin, TX 78701, US" or one part a line. The street, city, state, ZIP and
 * country when it reads that way; otherwise all of it as the street.
 */
export function splitAddress(text: string): Address {
  const parts = text.split(/\s*[\n,]\s*/).map(p => p.trim()).filter(p => p !== '');
  const out: Address = {};
  if (parts.length > 1 && COUNTRIES.test(parts.at(-1)!)) out.country = parts.pop()!;
  const last = parts.at(-1) ?? '';
  const m = /^(?:(.*?)\s+)?([A-Z]{2})\s+(\d{5}(?:-\d{4})?|[A-Z]\d[A-Z] ?\d[A-Z]\d)(?:\s+(USA?|CA))?$/.exec(last);
  if (m && parts.length >= 2) {
    out.state = m[2]!;
    out.postal_code = m[3]!;
    if (m[4]) out.country ??= m[4];
    parts.pop();
    if (m[1]) out.city = m[1];
    else if (parts.length >= 2) out.city = parts.pop()!;
  }
  if (parts.length > 0) out.line1 = parts.join(', ');
  return out;
}

/** The first number in "Phone: (512) 555-0100 Mobile: (512) 555-0199"; the text as it is when there is none. */
export function firstPhone(text: string): string {
  const m = /\+?\d?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?:\s*(?:x|ext\.?)\s*\d+)?/i.exec(text);
  return (m ? m[0].trim() : text.trim()).slice(0, 40);
}

export function parseContacts(grid: Grid, what: 'Customers' | 'Vendors'): Parsed<ContactRow> {
  const header = findHeader(grid, CONTACT_COLS, ['name']);
  if (!header) return { rows: [], problems: [missingHeader(`${what} list`, 'the name')] };
  const c = header.cols;
  const rows: ContactRow[] = [];
  for (const row of bodyOf(grid, header.at)) {
    const name = cell(row, c.name);
    if (name === '' || isTotal(name)) continue;
    // Separate columns when the export has them; else the one address cell, taken apart.
    const separate = c.street !== undefined || c.city !== undefined;
    const address: Address = separate ? {} : splitAddress(cell(row, c.address));
    const street = separate ? cell(row, c.street) || cell(row, c.address) : '';
    if (street) address.line1 = street;
    if (cell(row, c.city)) address.city = cell(row, c.city);
    if (cell(row, c.state)) address.state = cell(row, c.state);
    if (cell(row, c.zip)) address.postal_code = cell(row, c.zip);
    if (cell(row, c.country)) address.country = cell(row, c.country);
    if (address.line1) address.line1 = address.line1.slice(0, 200);
    if (address.city) address.city = address.city.slice(0, 100);
    if (address.state) address.state = address.state.slice(0, 50);
    if (address.postal_code) address.postal_code = address.postal_code.slice(0, 20);
    if (address.country) address.country = address.country.slice(0, 80);
    rows.push({
      name: name.slice(0, 200), company_name: cell(row, c.company) || null,
      email: cell(row, c.email).split(/[,;\s]+/)[0] || null,
      phone: firstPhone(cell(row, c.phone)) || null,
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
  for (const row of bodyOf(grid, header.at)) {
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
  const groups = new Groups();
  for (const row of bodyOf(grid, header.at)) {
    if (groups.take(row)) continue;
    const date = parseDate(cell(row, c.date));
    if (!date) {
      if (badDate(cell(row, c.date), OPEN_COLS.date)) problems.push(notADate(cell(row, c.date)));
      continue;
    }
    const name = cell(row, c.name) || groups.name;
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
  cleared: ['clr', 'cleared', 'cleared status', 'reconcile status'],
  moneyIn: ['deposit', 'deposits', 'debit'],
  moneyOut: ['withdrawal', 'withdrawals', 'credit'],
  // In a bank register a payment is money out; in a card's, money in.
  payment: ['payment', 'payments'],
  charge: ['charge', 'charges'],
};

/**
 * QuickBooks' reconciliation report (its uncleared sections), or a report of
 * the account's transactions (Transaction Detail by Account, with the Clr
 * column or filtered to uncleared). Money into the account is positive: a
 * deposit, or a payment on a card. Rows after the cutover date are left out:
 * the team enters those here.
 */
export function parseUncleared(grid: Grid, opts: { cutover?: string; liability?: boolean } = {}): Parsed<UnclearedRow> {
  const header = findHeader(grid, UNCLEARED_COLS, ['date']);
  const c = header?.cols;
  const money = [c?.amount, c?.moneyIn, c?.moneyOut, c?.payment, c?.charge];
  if (!header || !c || money.every(i => i === undefined)) {
    return { rows: [], problems: [missingHeader('reconciliation report or Transaction Detail by Account', 'the date and the amount')] };
  }
  const body = bodyOf(grid, header.at);
  // A reconciliation report has cleared sections too; only the uncleared ones count.
  const sectioned = body.some(r => /uncleared/i.test(headingOf(r) ?? ''));
  let inUncleared = !sectioned;
  let sign: 1 | -1 | 0 = 0;
  const rows: UnclearedRow[] = [];
  const problems: string[] = [];
  let cleared = 0;
  let later = 0;
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
    if (!date) {
      if (badDate(cell(row, c.date), UNCLEARED_COLS.date)) problems.push(notADate(cell(row, c.date)));
      continue;
    }
    if (/^(c|r|cleared|reconciled)$/i.test(cell(row, c.cleared))) { cleared++; continue; }
    if (opts.cutover && date > opts.cutover) { later++; continue; }
    let amount: string | null | '';
    if (c.amount !== undefined) {
      amount = parseAmount(cell(row, c.amount));
      // A report of a card account shows what is owed going up as positive.
      if (amount && sign === 0 && opts.liability) amount = (-Number(amount)).toFixed(2);
    } else {
      const parts = [c.moneyIn, c.moneyOut, c.payment, c.charge].map(i => parseAmount(cell(row, i)));
      if (parts.some(p => p === null)) amount = null;
      else {
        const [moneyIn, moneyOut, payment, charge] = parts.map(p => Number(p || 0)) as [number, number, number, number];
        amount = (moneyIn - moneyOut + (opts.liability ? payment : -payment) - charge).toFixed(2);
      }
    }
    if (amount === null || amount === '') { problems.push(`${date}: the amount isn't a number`); continue; }
    if (sign !== 0) amount = (sign * Math.abs(Number(amount))).toFixed(2);
    rows.push({
      date, type: cell(row, c.type) || null, number: cell(row, c.number) || null,
      name: cell(row, c.name) || null, memo: cell(row, c.memo) || null, amount,
    });
  }
  const notes: string[] = [];
  if (cleared > 0) notes.push(`${cleared} cleared ${cleared === 1 ? 'row was' : 'rows were'} left out`);
  if (later > 0) notes.push(`${later} dated after the cutover date ${later === 1 ? 'was' : 'were'} left out: enter ${later === 1 ? 'it' : 'them'} here`);
  return { rows, problems, notes };
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
  for (const row of bodyOf(grid, header.at)) {
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
  for (const row of bodyOf(grid, header.at)) {
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
    if (badDate(dateText, JOURNAL_COLS.date)) { problems.push(notADate(dateText)); current = null; continue; }
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
