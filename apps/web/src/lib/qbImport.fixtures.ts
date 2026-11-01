import * as XLSX from 'xlsx';

// A made-up client's QuickBooks Online exports, laid out as QuickBooks writes
// them: the company, the report and its date over the column headings, dates
// and amounts as Excel cells, rows grouped under a customer or vendor with
// "Total for" rows, and the line saying when the report was run at the foot.
// The figures agree with one another: the open invoices come to the trial
// balance's Accounts Receivable, the bills to its Accounts Payable, and the
// stock on hand to its Inventory. For the readers' tests, and for trying the
// page by hand (each file can be written out as .xlsx). Nothing here is real.

type Cell = string | number | { date: string } | null;
export type Sheet = Cell[][];

export const COMPANY = 'Maple Street Bakery LLC';
export const CUTOVER = '2026-10-31';
const FOOTER = 'Accrual Basis Saturday, October 31, 2026 04:12 PM GMT-04:00';
const title = (report: string, when: string): Sheet => [[COMPANY], [report], [when], []];
const d = (date: string) => ({ date });

export const accountList: Sheet = [
  ...title('Account List', ''),
  ['Account', 'Type', 'Detail type', 'Description', 'Balance'],
  ['Business Checking', 'Bank', 'Checking', 'Main operating account', 18452.35],
  ['Savings', 'Bank', 'Savings', '', 45000],
  ['Accounts Receivable (A/R)', 'Accounts receivable (A/R)', 'Accounts Receivable (A/R)', '', 3020],
  ['Inventory Asset', 'Other Current Assets', 'Inventory', '', 160],
  ['Undeposited Funds', 'Other Current Assets', 'Undeposited Funds', '', 0],
  ['Equipment', 'Fixed Assets', 'Machinery & Equipment', 'Ovens and mixers', 33600],
  ['Equipment:Original Cost', 'Fixed Assets', 'Machinery & Equipment', '', 42000],
  ['Equipment:Accumulated Depreciation', 'Fixed Assets', 'Accumulated Depreciation', '', -8400],
  ['Accounts Payable (A/P)', 'Accounts payable (A/P)', 'Accounts Payable (A/P)', '', 1315.5],
  ['Chase Visa', 'Credit Card', 'Credit Card', '', 2184.75],
  ['Sales Tax Payable', 'Other Current Liabilities', 'Sales Tax Payable', '', 612.4],
  ['Equipment Loan', 'Long Term Liabilities', 'Notes Payable', '', 21500],
  ['Opening Balance Equity', 'Equity', 'Opening Balance Equity', '', 0],
  ["Owner's Investment", 'Equity', "Owner's Equity", '', 30000],
  ['Retained Earnings', 'Equity', 'Retained Earnings', '', null],
  ['Bakery Sales', 'Income', 'Sales of Product Income', '', null],
  ['Catering Income', 'Income', 'Service/Fee Income', '', null],
  ['Cost of Goods Sold', 'Cost of Goods Sold', 'Supplies & Materials - COGS', '', null],
  ['Rent or Lease', 'Expenses', 'Rent or Lease of Buildings', '', null],
  ['Utilities', 'Expenses', 'Utilities', '', null],
  ['Utilities:Electric', 'Expenses', 'Utilities', '', null],
  ['Utilities:Gas', 'Expenses', 'Utilities', '', null],
  ['Bank Charges', 'Expenses', 'Bank Charges', '', null],
  ['Interest Income', 'Other Income', 'Interest Earned', '', null],
  ['Depreciation', 'Other Expense', 'Depreciation', '', null],
  [],
  [FOOTER],
];

export const customerContactList: Sheet = [
  ...title('Customer Contact List', 'All Dates'),
  ['Customer', 'Phone Numbers', 'Email', 'Full Name', 'Billing Address', 'Shipping Address'],
  ['Corner Market', 'Phone: (512) 555-0141', 'orders@cornermarket.example', 'Pat Rivera', '410 Elm St, Austin, TX 78702', ''],
  ['Green Grocer Co', 'Phone: (512) 555-0102 Mobile: (512) 555-0199', 'ap@greengrocer.example, owner@greengrocer.example', 'Sam Chen', '88 Market Ave\nSuite 4\nAustin, TX 78704 US', ''],
  ['Hilltop Cafe', '(512) 555-0177', 'hello@hilltop.example', 'Jo Park', '1200 Hill Rd, Round Rock, TX 78664', ''],
  ['Hilltop Cafe:Catering', '', 'events@hilltop.example', '', '', ''],
  ['Riverside School District', 'Phone: 512.555.0120 ext 12', 'purchasing@riverside.example', 'Lee Grant', 'PO Box 77, Pflugerville, TX 78660-0077', ''],
  ['Dana Lopez', '', '', 'Dana Lopez', '', ''],
  [],
  [FOOTER],
];

export const vendorContactList: Sheet = [
  ...title('Vendor Contact List', 'All Dates'),
  ['Vendor', 'Phone Numbers', 'Email', 'Full Name', 'Address', 'Account #'],
  ['City Power & Light', 'Phone: (800) 555-0110', 'billing@citypower.example', '', 'PO Box 1000, Austin, TX 78767', '44-1029-3'],
  ['Flour Mills Inc', 'Phone: (210) 555-0150', 'ar@flourmills.example', 'Kim Ortiz', '9 Mill Way, San Antonio, TX 78201', 'MSB-114'],
  ['Gas Utility Co', '', '', '', '', '7781200'],
  ['Landlord Properties LLC', 'Phone: (512) 555-0190', '', 'Ray Hall', '500 Congress Ave, Austin, TX 78701', ''],
  ['Packaging Plus', '', 'sales@packplus.example', '', '', ''],
  [],
  [FOOTER],
];

// The list page's own export (Sales -> Products and services -> Export): headings in the first row, no title.
export const productServiceList: Sheet = [
  ['Product/Service Name', 'Sales Description', 'SKU', 'Type', 'Sales Price / Rate', 'Taxable', 'Income Account', 'Purchase Description', 'Purchase Cost', 'Expense Account', 'Quantity On Hand', 'Reorder Point', 'Inventory Asset Account', 'Quantity as-of Date'],
  ['Sourdough Loaf', 'Country sourdough, 900 g', 'SD-1', 'Inventory', 8, 'Yes', 'Bakery Sales', '', 2.5, 'Cost of Goods Sold', 40, 10, 'Inventory Asset', d('2026-10-31')],
  ['Croissant Box', 'Six butter croissants', 'CR-6', 'Inventory', 18, 'Yes', 'Bakery Sales', '', 6, 'Cost of Goods Sold', 10, 4, 'Inventory Asset', d('2026-10-31')],
  ['Catering Service', 'Event catering, per hour', '', 'Service', 75, 'No', 'Catering Income', '', null, '', null, null, '', null],
  ['Delivery', 'Local delivery', '', 'Non-inventory', 15, 'No', 'Catering Income', '', null, '', null, null, '', null],
  ['Breakfast Bundle', 'Loaf and croissants', '', 'Bundle', null, '', '', '', null, '', null, null, '', null],
];

// Grouped by customer; Hilltop Cafe's sub-customer has its own heading and total inside the parent's.
export const openInvoices: Sheet = [
  ...title('Open Invoices', 'As of October 31, 2026'),
  ['', 'Date', 'Transaction Type', 'Num', 'Terms', 'Due Date', 'Open Balance'],
  ['Corner Market'],
  ['', d('2026-10-20'), 'Invoice', '1051', 'Net 15', d('2026-11-04'), 240],
  ['Total for Corner Market', '', '', '', '', '', 240],
  ['Green Grocer Co'],
  ['', d('2026-09-28'), 'Invoice', '1046', 'Net 30', d('2026-10-28'), 480],
  ['', d('2026-10-25'), 'Payment', '', '', d('2026-10-25'), -100],
  ['Total for Green Grocer Co', '', '', '', '', '', 380],
  ['Hilltop Cafe'],
  ['Catering'],
  ['', d('2026-10-15'), 'Invoice', '1050', 'Net 30', d('2026-11-14'), 900],
  ['Total for Catering', '', '', '', '', '', 900],
  ['', d('2026-10-10'), 'Invoice', '1049', 'Net 30', d('2026-11-09'), 300],
  ['', d('2026-10-18'), 'Credit Memo', '1052', '', d('2026-10-18'), -50],
  ['Total for Hilltop Cafe', '', '', '', '', '', 1150],
  ['Riverside School District'],
  ['', d('2026-08-30'), 'Invoice', '1040', 'Net 45', d('2026-10-14'), 1250],
  ['Total for Riverside School District', '', '', '', '', '', 1250],
  ['TOTAL', '', '', '', '', '', 3020],
  [],
  [FOOTER],
];

export const unpaidBills: Sheet = [
  ...title('Unpaid Bills', 'All Dates'),
  ['', 'Date', 'Transaction Type', 'Num', 'Due Date', 'Past Due', 'Amount', 'Open Balance'],
  ['City Power & Light'],
  ['', d('2026-10-05'), 'Bill', 'E-1031', d('2026-10-25'), 6, 210, 210],
  ['Total for City Power & Light', '', '', '', '', '', 210, 210],
  ['Flour Mills Inc'],
  ['', d('2026-10-12'), 'Bill', 'FM-889', d('2026-11-11'), -11, 640, 640],
  ['', d('2026-10-20'), 'Vendor Credit', 'VC-12', '', '', -40, -40],
  ['', d('2026-10-26'), 'Bill', 'FM-901', d('2026-11-25'), -25, 380, 380],
  ['Total for Flour Mills Inc', '', '', '', '', '', 980, 980],
  ['Packaging Plus'],
  ['', d('2026-10-28'), 'Bill', 'PP-77', d('2026-11-27'), -27, 125.5, 125.5],
  ['Total for Packaging Plus', '', '', '', '', '', 125.5, 125.5],
  ['TOTAL', '', '', '', '', '', 1315.5, 1315.5],
  [],
  [FOOTER],
];

// The reconciliation report for the statement ending on the cutover date. The
// cleared sections and the item dated after the cutover are not to be read.
export const checkingReconciliation: Sheet = [
  [`${COMPANY}, Business Checking, Period Ending 10/31/2026`],
  ['RECONCILIATION REPORT'],
  ['Reconciled on: 11/02/2026'],
  ['Reconciled by: Owner'],
  ['Any changes made to transactions after this date aren\'t included in this report.'],
  ['Summary', '', '', '', 'USD'],
  ['Statement beginning balance', '', '', '', 16120.4],
  ['Checks and payments cleared (2)', '', '', '', -2300],
  ['Deposits and other credits cleared (1)', '', '', '', 4483.35],
  ['Statement ending balance', '', '', '', 18303.75],
  ['Register balance as of 10/31/2026', '', '', '', 18452.35],
  ['Details'],
  ['Checks and payments cleared (2)'],
  ['DATE', 'TYPE', 'REF NO.', 'PAYEE', 'AMOUNT (USD)'],
  [d('2026-10-01'), 'Check', '1180', 'Landlord Properties LLC', -2000],
  [d('2026-10-14'), 'Bill Payment', '1184', 'City Power & Light', -300],
  ['Total', '', '', '', -2300],
  ['Deposits and other credits cleared (1)'],
  ['DATE', 'TYPE', 'REF NO.', 'PAYEE', 'AMOUNT (USD)'],
  [d('2026-10-16'), 'Deposit', '', '', 4483.35],
  ['Total', '', '', '', 4483.35],
  ['Additional Information'],
  ['Uncleared checks and payments as of 10/31/2026'],
  ['DATE', 'TYPE', 'REF NO.', 'PAYEE', 'AMOUNT (USD)'],
  [d('2026-10-29'), 'Check', '1187', 'Gas Utility Co', -86.4],
  [d('2026-10-30'), 'Bill Payment', '1188', 'Flour Mills Inc', -500],
  ['Total', '', '', '', -586.4],
  ['Uncleared deposits and other credits as of 10/31/2026'],
  ['DATE', 'TYPE', 'REF NO.', 'PAYEE', 'AMOUNT (USD)'],
  [d('2026-10-31'), 'Deposit', '', '', 735],
  ['Total', '', '', '', 735],
  ['Uncleared checks and payments after 10/31/2026'],
  ['DATE', 'TYPE', 'REF NO.', 'PAYEE', 'AMOUNT (USD)'],
  [d('2026-11-02'), 'Check', '1189', 'Landlord Properties LLC', -2000],
  ['Total', '', '', '', -2000],
];

// The card's Transaction Detail by Account with the Clr column: what is owed going up is positive.
export const visaTransactionDetail: Sheet = [
  ...title('Transaction Detail by Account', 'October 1-31, 2026'),
  ['', 'Date', 'Transaction Type', 'Num', 'Name', 'Memo/Description', 'Clr', 'Split', 'Amount', 'Balance'],
  ['Chase Visa'],
  ['', d('2026-10-15'), 'Expense', '', 'Packaging Plus', 'Boxes', 'R', 'Cost of Goods Sold', 45, 2015.55],
  ['', d('2026-10-27'), 'Expense', '', 'Packaging Plus', 'Labels', '', 'Cost of Goods Sold', 64.2, 2079.75],
  ['', d('2026-10-30'), 'Expense', '', 'Flour Mills Inc', 'Rye flour', '', 'Cost of Goods Sold', 120, 2199.75],
  ['', d('2026-10-31'), 'Credit Card Credit', '', 'Packaging Plus', 'Returned labels', '', 'Cost of Goods Sold', -15, 2184.75],
  ['Total for Chase Visa', '', '', '', '', '', '', '', 214.2, ''],
  ['TOTAL', '', '', '', '', '', '', '', 214.2, ''],
  [],
  [FOOTER],
];

const TB_LINES: [string, number, number][] = [
  ['Business Checking', 18452.35, 0],
  ['Savings', 45000, 0],
  ['Accounts Receivable (A/R)', 3020, 0],
  ['Inventory Asset', 160, 0],
  ['Equipment:Original Cost', 42000, 0],
  ['Equipment:Accumulated Depreciation', 0, 8400],
  ['Accounts Payable (A/P)', 0, 1315.5],
  ['Chase Visa', 0, 2184.75],
  ['Sales Tax Payable', 0, 612.4],
  ['Equipment Loan', 0, 21500],
  ["Owner's Investment", 0, 30000],
  ['Bakery Sales', 0, 96450],
  ['Catering Income', 0, 18200],
  ['Cost of Goods Sold', 31840, 0],
  ['Rent or Lease', 40000, 0],
  ['Utilities:Electric', 3912.6, 0],
  ['Utilities:Gas', 1644.15, 0],
  ['Bank Charges', 240, 0],
  ['Interest Income', 0, 310.35],
  ['Depreciation', 2800, 0],
];
const round2 = (n: number) => Math.round(n * 100) / 100;
const tbDebits = round2(TB_LINES.reduce((s, l) => s + l[1], 0));
const tbCredits = round2(TB_LINES.reduce((s, l) => s + l[2], 0));
/** Retained Earnings is what makes the trial balance balance. */
export const RETAINED_EARNINGS = round2(tbDebits - tbCredits);
export const TB_TOTAL = tbDebits;

export const trialBalance: Sheet = [
  ...title('Trial Balance', 'As of October 31, 2026'),
  ['', 'Debit', 'Credit'],
  ...TB_LINES.slice(0, 11).map(([a, dr, cr]) => [a, dr || null, cr || null]),
  ['Retained Earnings', null, RETAINED_EARNINGS],
  ...TB_LINES.slice(11).map(([a, dr, cr]) => [a, dr || null, cr || null]),
  ['TOTAL', TB_TOTAL, TB_TOTAL],
  [],
  [FOOTER],
];

// A slice of history: October's transactions, one block each, with its total row.
export const journal: Sheet = [
  ...title('Journal', 'October 1-31, 2026'),
  ['', 'Date', 'Transaction Type', 'Num', 'Name', 'Memo/Description', 'Account', 'Debit', 'Credit'],
  ['', d('2026-10-01'), 'Check', '1180', 'Landlord Properties LLC', 'October rent', 'Rent or Lease', 2000, null],
  ['', '', '', '', 'Landlord Properties LLC', '', 'Business Checking', null, 2000],
  ['', '', '', '', '', '', '', 2000, 2000],
  ['', d('2026-10-05'), 'Bill', 'E-1031', 'City Power & Light', '', 'Utilities:Electric', 210, null],
  ['', '', '', '', 'City Power & Light', '', 'Accounts Payable (A/P)', null, 210],
  ['', '', '', '', '', '', '', 210, 210],
  ['', d('2026-10-15'), 'Expense', '', 'Packaging Plus', 'Boxes', 'Cost of Goods Sold', 45, null],
  ['', '', '', '', 'Packaging Plus', '', 'Chase Visa', null, 45],
  ['', '', '', '', '', '', '', 45, 45],
  ['', d('2026-10-16'), 'Deposit', '', '', 'Week of 10/12', 'Business Checking', 4483.35, null],
  ['', '', '', '', 'Corner Market', '', 'Bakery Sales', null, 4100],
  ['', '', '', '', '', '', 'Sales Tax Payable', null, 383.35],
  ['', '', '', '', '', '', '', 4483.35, 4483.35],
  ['', d('2026-10-29'), 'Check', '1187', 'Gas Utility Co', '', 'Utilities:Gas', 86.4, null],
  ['', '', '', '', 'Gas Utility Co', '', 'Business Checking', null, 86.4],
  ['', '', '', '', '', '', '', 86.4, 86.4],
  ['TOTAL', '', '', '', '', '', '', 6824.75, 6824.75],
  [],
  [FOOTER],
];

/** Every file, by the name QuickBooks would give it. */
export const EXPORTS: Record<string, Sheet> = {
  'Maple Street Bakery LLC_Account List.xlsx': accountList,
  'Maple Street Bakery LLC_Customer Contact List.xlsx': customerContactList,
  'Maple Street Bakery LLC_Vendor Contact List.xlsx': vendorContactList,
  'ProductServiceList__9341455412345678_10_31_2026.xlsx': productServiceList,
  'Maple Street Bakery LLC_Open Invoices.xlsx': openInvoices,
  'Maple Street Bakery LLC_Unpaid Bills.xlsx': unpaidBills,
  'Business Checking_Reconciliation Report_2026-10-31.xlsx': checkingReconciliation,
  'Maple Street Bakery LLC_Transaction Detail by Account (Chase Visa).xlsx': visaTransactionDetail,
  'Maple Street Bakery LLC_Journal.xlsx': journal,
  'Maple Street Bakery LLC_Trial Balance.xlsx': trialBalance,
};

const serial = (iso: string) => (Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) - Date.UTC(1899, 11, 30)) / 86_400_000;

/** The sheet as an Excel file: amounts as numbers shown "#,##0.00", dates as dates shown "mm/dd/yyyy". */
export function toXlsx(sheet: Sheet): ArrayBuffer {
  const ws: XLSX.WorkSheet = {};
  let width = 0;
  sheet.forEach((row, r) => {
    width = Math.max(width, row.length);
    row.forEach((v, c) => {
      if (v === null || v === '') return;
      const ref = XLSX.utils.encode_cell({ r, c });
      if (typeof v === 'number') ws[ref] = Number.isInteger(v) ? { t: 'n', v } : { t: 'n', v, z: '#,##0.00' };
      else if (typeof v === 'object') ws[ref] = { t: 'n', v: serial(v.date), z: 'mm/dd/yyyy' };
      else ws[ref] = { t: 's', v };
    });
  });
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(sheet.length - 1, 0), c: Math.max(width - 1, 0) } });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

/** The same sheet saved as CSV, as Excel would write it. */
export function toCsv(sheet: Sheet): ArrayBuffer {
  const text = XLSX.utils.sheet_to_csv(XLSX.read(toXlsx(sheet), { type: 'array' }).Sheets['Sheet1']!);
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}
